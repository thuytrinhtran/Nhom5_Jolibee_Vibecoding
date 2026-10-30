const {test}=require('node:test'),assert=require('node:assert/strict');
test('TV2 saves are immediately visible in TV3 API: draft, resubmit, OFF, sample exclusion and scope', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness(),q=(s,p=[])=>h.sql.query(s,p);
 const {supabaseAdmin:db}=require('../dist/config/supabase.js');const original=db.auth.getUser;
 await q('INSERT INTO auth.users VALUES($1)',[h.id(80)]);
 await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'integration_manager','QL',$2)",[h.id(80),h.id(1)]);
 db.auth.getUser=async token=>token==='manager-fixture'?{data:{user:{id:h.id(80)}},error:null}:original(token);
 const server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  const period=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0];
  const save=async(mode,prefs)=>{const r=await fetch(base+`/registrations/${h.id(8)}/me`,{method:'PUT',headers:{Authorization:'Bearer isolated-api-access','Content-Type':'application/json'},body:JSON.stringify({mode,preferences:prefs})});assert.equal(r.status,200);};
  const summary=async()=>{const r=await fetch(base+`/schedules/periods/${h.id(8)}/registrations-summary`,{headers:{Authorization:'Bearer manager-fixture'}});assert.equal(r.status,200);return(await r.json()).result;};
  const p1=[{work_date:period.d,shift_id:h.id(5)}],p2=[{work_date:period.d,shift_id:h.id(6)}];
  let result=await summary();assert.ok(result.registration_declarations.every(d=>d.declaration==='NOT_SUBMITTED'));
  await save('draft',p1);assert.equal((await summary()).rows.length,0);
  await save('submit',p1);result=await summary();assert.equal(result.rows.length,1);assert.equal(result.rows[0].shift_id,h.id(5));assert.equal(result.registration_declarations.filter(d=>d.declaration==='OFF').length,6);
  await save('submit',p2);result=await summary();assert.equal(result.rows.length,1);assert.equal(result.rows[0].shift_id,h.id(6));
  await save('submit',[]);result=await summary();assert.equal(result.rows.length,0);assert.ok(result.registration_declarations.every(d=>d.declaration==='OFF'));
  await save('draft',[]);assert.ok((await summary()).registration_declarations.every(d=>d.declaration==='NOT_SUBMITTED'));
  await save('submit',p1);
  await q("INSERT INTO audit_logs(id,entity_id,entity_type,action) VALUES($1,$1,'fixture','TEST')",[h.id(90)]);
  await q('UPDATE registration_submissions SET sample_batch_id=$1',[h.id(90)]);
  result=await summary();assert.equal(result.rows.length,0);assert.ok(result.registration_declarations.every(d=>d.declaration==='NOT_SUBMITTED'));
  await save('submit',p2);assert.equal((await summary()).rows[0].shift_id,h.id(6));
  await q("UPDATE registration_periods SET status='PLANNED'");assert.equal((await summary()).period.status,'OPEN');
  await q("INSERT INTO branches(id,name) VALUES($1,'Other scope')",[h.id(91)]);await q('UPDATE users SET branch_id=$1 WHERE id=$2',[h.id(91),h.id(80)]);
  const r=await fetch(base+`/schedules/periods/${h.id(8)}/registrations-summary`,{headers:{Authorization:'Bearer manager-fixture'}});assert.equal(r.status,404);
 }finally{db.auth.getUser=original;await new Promise(r=>server.close(r));await h.close();}
});
