const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const app=require('../dist/server.js').default;
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
test('registration HTTP ownership, role, save response, deadline and automation guards',async()=>{
 const original={from:db.from,rpc:db.rpc,getUser:db.auth.getUser};
 const uid='00000000-0000-0000-0000-000000000010', branch='00000000-0000-0000-0000-000000000001',periodId='00000000-0000-0000-0000-000000000040',shift='00000000-0000-0000-0000-000000000030';
 let role='NV',periodStatus='OPEN',sampleHeader=false,schemaMissing=false,calls=[];
 const employee={id:'own-employee',user_id:uid,full_name:'Fixture',branch_id:branch,department_id:'dept',status:'ACTIVE',skill_level:'REGULAR'};
 const period={id:periodId,branch_id:branch,status:'OPEN',work_start_date:'2026-11-02',work_end_date:'2026-11-08',open_at:new Date(Date.now()-3600000).toISOString(),close_at:new Date(Date.now()+3600000).toISOString()};
 db.auth.getUser=async()=>({data:{user:{id:uid}},error:null});
 db.from=table=>{const filters=[];const query={select(){return this},eq(k,v){filters.push([k,v]);return this},lte(){return this},in(){return this},gt(){return this},or(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve(result()).then(resolve)},single:async()=>result(),maybeSingle:async()=>result()};
 function result(){
 if(table==='registration_submissions_sourced'&&schemaMissing)return{data:null,error:{code:'42703'}};
 if(table==='users')return{data:{id:uid,username:'fixture',role,branch_id:branch,is_active:true,must_change_password:false},error:null};
 if(table==='employees') {assert.ok(filters.some(([k,v])=>k==='user_id'&&v===uid));return{data:employee,error:null};}
 if(table==='branches')return{data:{name:'Fixture'},error:null};
 if(table==='registration_periods')return{data:filters.some(([k])=>k==='id')?{...period,status:periodStatus}:[{...period,status:periodStatus}],error:null};
 if(table==='registration_schedule_config')return{data:{timezone:'Asia/Ho_Chi_Minh',open_iso_day:5,open_local_time:'15:00:00',close_iso_day:7,close_local_time:'12:00:00',reminder_minutes:30},error:null};
 if(table==='shifts')return{data:[{id:shift,start_time:'08:00:00',end_time:'12:00:00'}],error:null};
 if(table==='shift_registrations'||table==='registration_submissions_sourced'){assert.ok(filters.some(([k,v])=>k==='employee_id'&&v===employee.id));return{data:table==='registration_submissions_sourced'?(sampleHeader?{status:'VALID',sample_batch_id:'sample-fixture'}:null):(sampleHeader?[{work_date:'2026-11-02',shift_id:shift,status:'VALID'}]:[]),error:null};}
 throw Error('Unexpected table');
 }return query;};
 db.rpc=async(name,args)=>{calls.push({name,args});return{data:{registration_status:args.p_submit?'VALID':'DRAFT',errors:[]},error:null};};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const headers={'Content-Type':'application/json',Authorization:'Bearer isolated-fixture'};
 const send=body=>fetch(base+`/api/registrations/${periodId}/me`,{method:'PUT',headers,body:JSON.stringify(body)});
 try{
 assert.equal((await fetch(base+'/api/registrations/current')).status,401);
 let r=await fetch(base+'/api/registrations/current',{headers});assert.equal(r.status,200);assert.equal((await r.json()).employee.id,employee.id);
 const RealDate=Date;const savedWindow={open_at:period.open_at,close_at:period.close_at};
 try {
 period.open_at='2026-10-30T15:00:00+07:00';period.close_at='2026-11-01T12:00:00+07:00';periodStatus='PLANNED';
 for(const [at,status] of [['2026-10-30T14:59:00+07:00','PLANNED'],['2026-10-30T15:00:00+07:00','OPEN'],['2026-11-01T11:59:00+07:00','OPEN'],['2026-11-01T12:00:00+07:00','CLOSED']]){
 const instant=RealDate.parse(at);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}};
 r=await fetch(base+'/api/registrations/current',{headers});assert.equal(r.status,200);assert.equal((await r.json()).period.status,status);
 const previousCalls=calls.length;assert.equal((await send({mode:'draft',preferences:[]})).status,status==='OPEN'?200:409);
 if(status!=='OPEN')assert.equal(calls.length,previousCalls);
 }
 }finally{global.Date=RealDate;Object.assign(period,savedWindow);periodStatus='OPEN';calls=[];}
 schemaMissing=true; r=await fetch(base+'/api/registrations/current',{headers});assert.equal(r.status,503);assert.equal((await r.json()).code,'REGISTRATION_SCHEMA_NOT_READY');schemaMissing=false;
 sampleHeader=true;r=await fetch(base+'/api/registrations/current',{headers});const sampleData=await r.json();assert.equal(sampleData.has_sample_data,true);assert.equal(sampleData.submission,null);assert.deepEqual(sampleData.registrations,[]);sampleHeader=false;
 for(const key of ['employee_id','user_id','p_user'])assert.equal((await send({mode:'submit',preferences:[],[key]:'victim'})).status,400);assert.equal(calls.length,0);
 for(const mode of ['draft','submit']){r=await send({mode,preferences:[{work_date:'2026-11-02',shift_id:shift}]});assert.equal(r.status,200);const data=await r.json();assert.equal(data.status,'ok');assert.equal(data.registration_status,mode==='draft'?'DRAFT':'VALID');assert.equal(calls.at(-1).args.p_user,uid);}
 r=await send({mode:'submit',preferences:[]});assert.equal(r.status,200);assert.equal((await r.json()).registration_status,'VALID');
 periodStatus='PLANNED';r=await fetch(base+'/api/registrations/current',{headers});assert.equal((await r.json()).period.status,'OPEN');assert.equal((await send({mode:'draft',preferences:[]})).status,200);
 period.close_at=new Date(Date.now()-1000).toISOString();const count=calls.length;assert.equal((await send({mode:'draft',preferences:[]})).status,409);assert.equal(calls.length,count);
 role='QL';assert.equal((await fetch(base+'/api/registrations/current',{headers})).status,403);
 role='NV';assert.equal((await fetch(base+'/api/registrations/'+periodId+'/someone-else',{headers})).status,404);
 const prev=process.env.REGISTRATION_AUTOMATION_TOKEN;delete process.env.REGISTRATION_AUTOMATION_TOKEN;
 assert.equal((await fetch(base+'/api/internal/registration-automation/run',{method:'POST'})).status,503);
 process.env.REGISTRATION_AUTOMATION_TOKEN='x'.repeat(32);
 assert.equal((await fetch(base+'/api/internal/registration-automation/run',{method:'POST',headers})).status,401);
 const internalHeaders={'Content-Type':'application/json',Authorization:'Bearer '+process.env.REGISTRATION_AUTOMATION_TOKEN};
 for(const body of ['{"now":"2026-10-29"}','[]'])assert.equal((await fetch(base+'/api/internal/registration-automation/run',{method:'POST',headers:internalHeaders,body})).status,400);
 db.rpc=async(name,args)=>{assert.equal(name,'run_registration_automation');assert.equal(args,undefined);return{data:{created:0,queued_reminders:0},error:null};};
 r=await fetch(base+'/api/internal/registration-automation/run',{method:'POST',headers:internalHeaders,body:'{}'});assert.equal(r.status,200);assert.equal((await r.json()).result.created,0);
 db.rpc=async()=>({data:null,error:{code:'fixture-error'}});
 assert.equal((await fetch(base+'/api/internal/registration-automation/run',{method:'POST',headers:internalHeaders})).status,503);
 db.rpc=async()=>{throw Error('Isolated transport rejection');};
 assert.equal((await fetch(base+'/api/internal/registration-automation/run',{method:'POST',headers:internalHeaders})).status,503);
 if(prev===undefined)delete process.env.REGISTRATION_AUTOMATION_TOKEN;else process.env.REGISTRATION_AUTOMATION_TOKEN=prev;
 }finally{db.from=original.from;db.rpc=original.rpc;db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});

test('server advertises the scoped time exception and uses token identity on its real save route',async()=>{
 const dev=require('../dist/registrations/dev-test-window.js'),s=dev.DEV_TEST_REGISTRATION_SCOPE;
 const saved={...process.env},original={from:db.from,rpc:db.rpc,getUser:db.auth.getUser,persist:dev.persistDevTestRegistration};
 const uid='00000000-0000-4000-8000-000000000101',shift='00000000-0000-4000-8000-000000000102';let calls=[];
 const period={id:s.period,branch_id:s.branch,work_start_date:s.start,work_end_date:s.end,open_at:'2099-01-01T00:00:00Z',close_at:'2099-01-02T00:00:00Z',status:'PLANNED'};
 Object.assign(process.env,{REGISTRATION_DEV_TEST_MODE:'true',NODE_ENV:'development',SUPABASE_URL:`https://${s.project}.supabase.co`});
 db.auth.getUser=async()=>({data:{user:{id:uid}},error:null});
 db.from=table=>{const filters=[];const query={select(){return this},eq(k,v){filters.push([k,v]);return this},lte(){return this},in(){return this},gt(){return this},or(){return this},order(){return this},limit(){return this},single:async()=>result(),maybeSingle:async()=>result(),then(resolve){return Promise.resolve(result()).then(resolve)}};
  function result(){const data=table==='users'?{id:uid,username:'fixture',role:'NV',branch_id:s.branch,is_active:true,must_change_password:false}:table==='employees'?{id:'own-employee',user_id:uid,branch_id:s.branch,status:'ACTIVE',skill_level:'REGULAR'}:table==='branches'?{name:'Fixture'}:table==='registration_periods'?(filters.some(([k])=>k==='id')?(filters.some(([k,v])=>k==='id'&&v===s.period)?period:null):[period]):table==='shifts'?[{id:shift,start_time:'08:00:00',end_time:'12:00:00'}]:table==='registration_schedule_config'?{timezone:'Asia/Ho_Chi_Minh'}:table==='registration_submissions_sourced'?null:[];return{data,error:null};}return query;};
 db.rpc=async()=>{throw Error('No ordinary RPC expected while bypassing its clock gate');};
 dev.persistDevTestRegistration=async(...args)=>{calls.push(args);return{registration_status:'VALID',errors:[]}};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/registrations`,headers={Authorization:'Bearer isolated-fixture','Content-Type':'application/json'};
 try{
  const current=await(await fetch(base+'/current',{headers})).json();assert.equal(current.period.id,s.period);assert.equal(current.registration_window.dev_test_override,true);assert.equal(current.period.status,'PLANNED');
  const body={mode:'submit',preferences:[{work_date:s.start,shift_id:shift}]};
  const send=(periodId,value)=>fetch(`${base}/${periodId}/me`,{method:'PUT',headers,body:JSON.stringify(value)});
  assert.equal((await send(s.period,body)).status,200);assert.equal(calls[0][0],uid);assert.equal(calls[0][1],s.period);
  assert.equal((await send(s.period,{...body,employee_id:'other'})).status,400);
  assert.equal((await send(s.period,{...body,preferences:[...body.preferences,...body.preferences]})).status,400);
  assert.equal((await send('79a979cc-8347-48b5-a411-f03bd8aceb92',body)).status,403);assert.equal(calls.length,1);
  process.env.REGISTRATION_DEV_TEST_MODE='false';assert.equal((await send(s.period,body)).status,409);assert.equal(calls.length,1);
  Object.assign(process.env,{TV3_WRITE_SCOPE_MODE:'integration-test',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_PROJECT_REF:s.project,TV3_WRITE_BRANCH_ID:s.branch,TV3_WRITE_PERIOD_ID:'0f38b6da-4552-4885-9c0b-dbb295e8ef8c'});
  assert.equal((await send(s.period,body)).status,403,'integration session must not save another period');assert.equal(calls.length,1);
 }finally{db.from=original.from;db.rpc=original.rpc;db.auth.getUser=original.getUser;dev.persistDevTestRegistration=original.persist;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);await new Promise(r=>server.close(r));}
});
