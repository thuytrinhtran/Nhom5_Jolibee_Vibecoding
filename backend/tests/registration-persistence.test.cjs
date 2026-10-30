const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
test('real API path persists submissions, derived OFF and prioritizes active OPEN', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();let server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api';
 try{
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({email:'api-fixture@example.invalid',password:'Fixture-only-Password!1'})});assert.equal(login.status,200);const token=(await login.json()).access_token;const headers={Connection:'close',Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const load=async()=>{const r=await fetch(base+'/registrations/current',{headers});assert.equal(r.status,200);return r.json();};
 // Regression: an expired earlier week must not hide the effective OPEN period.
 await h.sql.query("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) SELECT $1,branch_id,work_start_date-7,work_end_date-7,open_at-interval '7 days',close_at-interval '7 days','CLOSED' FROM registration_periods WHERE id=$2",[h.id(9),h.id(8)]);
 await h.sql.query("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) SELECT $1,branch_id,work_start_date+7,work_end_date+7,now()+interval '1 hour',now()+interval '2 hours','PLANNED' FROM registration_periods WHERE id=$2",[h.id(10),h.id(8)]);
 let data=await load();assert.equal(data.period.id,h.id(8));assert.equal(data.period.status,'OPEN');assert.ok(!('off_dates' in data));
 const period=data.period,preferences=data.shifts.map(s=>({work_date:period.work_start_date,shift_id:s.id}));
 const save=(mode,items=preferences)=>fetch(base+'/registrations/'+period.id+'/me',{method:'PUT',headers,body:JSON.stringify({mode,preferences:items})});
 const coverage=async()=>{await h.sql.query("SELECT set_config('app.tv2_period_id',$1,false)",[period.id]);return h.sql.exec(fs.readFileSync(path.join(__dirname,'../../docs/tv2-release/tv3-contract.sql'),'utf8'));};
 assert.ok((await coverage())[1].rows.every(r=>r.declaration==='NOT_SUBMITTED'));
 assert.equal((await save('draft')).status,200);data=await load();assert.equal(data.submission.status,'DRAFT');assert.equal(data.submission.submitted_at,null);assert.equal(data.registrations.length,3);assert.ok((await coverage())[1].rows.every(r=>r.declaration==='NOT_SUBMITTED'));
 assert.equal((await save('submit')).status,200);data=await load();assert.equal(data.submission.status,'VALID');assert.ok(data.submission.submitted_at);let views=await coverage();assert.equal(views[0].rows.length,3);assert.equal(views[1].rows.filter(r=>r.declaration==='OFF').length,6);
 assert.equal(views[2].rows.length,3);assert.ok(views[2].rows.every(r=>r.employee_id===h.id(4)&&r.period_id===period.id&&r.work_date&&r.shift_id&&r.submitted_at));
 assert.equal((await save('submit',[])).status,200);data=await load();assert.equal(data.registrations.length,0);assert.equal(data.submission.status,'VALID');views=await coverage();assert.equal(views[1].rows.filter(r=>r.declaration==='OFF').length,7);assert.equal(views[2].rows.length,0);
 assert.equal((await save('draft',[])).status,200);assert.ok((await coverage())[1].rows.every(r=>r.declaration==='NOT_SUBMITTED'));
 // Simulate backend restart and a fresh TV1 login; the same database is retained.
 await new Promise(r=>server.close(r));const port=Number(new URL(base).port);server=h.app.listen(port,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const relogin=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({email:'api-fixture@example.invalid',password:'Fixture-only-Password!1'})});assert.equal(relogin.status,200);
 data=await load();assert.equal(data.submission.status,'DRAFT');
 await save('submit',preferences.slice(0,1));await h.sql.query("UPDATE registration_periods SET close_at=now()-interval '1 minute' WHERE id=$1",[period.id]);assert.equal((await save('draft')).status,409);
 // Upcoming PLANNED is shown only when no editable OPEN remains.
 assert.equal((await load()).period.id,h.id(10));await h.sql.exec(fs.readFileSync(path.join(__dirname,'../../docs/tv2-release/preflight.sql'),'utf8'));
 }finally{await new Promise(r=>server.close(r));await h.close();}
});
