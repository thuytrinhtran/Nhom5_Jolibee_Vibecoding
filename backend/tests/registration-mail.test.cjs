const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SECRET_KEY='isolated-fixture-only';
const {deliverRegistrationReminders,reminderWindow}=require('../dist/services/registration-mail.service.js');
const {MailDeliveryError}=require('../dist/services/google-mail.service.js');
const {startRegistrationMailWorker,registrationMailStatus}=require('../dist/services/registration-mail.service.js');
const {runRegistrationMailCycle}=require('../dist/services/registration-mail.service.js');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const period={id:id(1),branch_id:id(2),work_start_date:'2026-11-09',work_end_date:'2026-11-15',open_at:'2026-11-04T20:31:57+07:00',close_at:'2026-11-08T12:00:00+07:00'};
const config={timezone:'Asia/Ho_Chi_Minh',reminder_minutes:30};
let sequence=100;
function fixture(change={}){
 const notice={id:id(sequence++),recipient_id:id(3),title:'Nhắc đăng ký ca',content:'Nội dung nhắc',idempotency_key:`reg-reminder:${id(1)}:${id(4)}`};
 const state={at:Date.parse('2026-11-08T11:30:00+07:00'),period:{...period},latest:{...period},employee:{id:id(4),user_id:id(3),branch_id:id(2),status:'ACTIVE',skill_level:'REGULAR'},user:{id:id(3),role:'NV',is_active:true,branch_id:id(2)},header:null,email:'fixture@example.invalid',branch:{status:'ACTIVE'},...change};
 let reads=0,auths=0;
 const db={from(table){reads++;const filters=[];
  const run=single=>{if(state.failTable===table)return{data:null,error:{message:'private detail'}};
   let data=table==='registration_schedule_config'?config:table==='registration_periods'?(single?state.latest:[state.period]):table==='notifications'?(state.emptyQueue?[]:[notice]):table==='employees'?state.employee:table==='users'?state.user:table==='branches'?state.branch:table==='registration_submissions'?state.header:assert.fail(table);
   if(table==='notifications'){assert.ok(filters.some(([k,v])=>k==='type'&&v==='REGISTRATION_REMINDER'));assert.ok(filters.some(([k,v])=>k==='idempotency_key'&&v===`reg-reminder:${period.id}:%`));}
   if(table==='registration_submissions'){assert.ok(filters.some(([k,v])=>k==='employee_id'&&v===id(4)));assert.ok(filters.some(([k,v])=>k==='period_id'&&v===period.id));}
   return{data,error:null};};
  return{select(){return this},eq(k,v){filters.push([k,v]);return this},like(k,v){filters.push([k,v]);return this},lte(){return this},gt(){return this},order(){return this},range(){return Promise.resolve(run(false))},single(){return Promise.resolve(run(true))},maybeSingle(){return Promise.resolve(run(true))}};
 },auth:{admin:{async getUserById(uid){auths++;assert.equal(uid,id(3));if(state.expireDuringAuth)state.at=Date.parse(period.close_at);if(state.submitDuringAuth)state.header={status:'VALID',submitted_at:'2026-11-08T04:31Z'};return{data:{user:{email:state.email}},error:null};}}}};
 return{state,notice,db,get reads(){return reads},get auths(){return auths},now:()=>state.at};
}

test('official reminder window, next week, early opening and exact close boundaries',()=>{
 for(const [at,expected] of [['2026-11-06T15:00:00+07:00',false],['2026-11-08T11:29:59+07:00',false],['2026-11-08T11:30:00+07:00',true],['2026-11-08T11:59:59+07:00',true],['2026-11-08T12:00:00+07:00',false]])assert.equal(reminderWindow(period,config,Date.parse(at)),expected,at);
 assert.equal(reminderWindow({...period,work_start_date:'2026-11-02'},config,Date.parse('2026-11-08T11:30+07:00')),false);
 assert.equal(reminderWindow({...period,close_at:'2026-11-07T12:00+07:00'},config,Date.parse('2026-11-07T11:30+07:00')),false);
});

test('cycle enqueues only when opted in, dry-run never writes, and missing migration fails closed',async()=>{
 const saved=process.env.EMAIL_NOTIFICATIONS_ENABLED;let calls=0;
 try{
  const f=fixture();f.db.rpc=async name=>{calls++;assert.equal(name,'enqueue_registration_mail_reminders');return{error:null,data:{queued_reminders:0}};};
  process.env.EMAIL_NOTIFICATIONS_ENABLED='false';await runRegistrationMailCycle({...f,send:async()=>assert.fail('No mail')});assert.equal(calls,0);
  process.env.EMAIL_NOTIFICATIONS_ENABLED='true';await runRegistrationMailCycle({...f,dryRun:true,send:async()=>assert.fail('No mail')});assert.equal(calls,0);
  await runRegistrationMailCycle({...f,send:async()=> 'sent'});assert.equal(calls,1);
  f.db.rpc=async()=>({error:{code:'PGRST202'},data:null});await assert.rejects(runRegistrationMailCycle({...f,send:async()=>assert.fail('No mail')}),/REGISTRATION_MAIL_QUEUE_UNAVAILABLE/);
 }finally{if(saved===undefined)delete process.env.EMAIL_NOTIFICATIONS_ENABLED;else process.env.EMAIL_NOTIFICATIONS_ENABLED=saved;}
});

test('enabled worker starts immediately, prevents duplicate loops, schedules 60 seconds, and stops',async()=>{
 const saved=process.env.EMAIL_NOTIFICATIONS_ENABLED,realSet=global.setTimeout,realClear=global.clearTimeout;
 let calls=0,scheduled,cleared=false,stop;
 global.setTimeout=(fn,delay)=>{assert.equal(delay,60000);scheduled=fn;return{unref(){}};};
 global.clearTimeout=()=>{cleared=true;};
 const run=async()=>{calls++;return{enabled:true,dry_run:false,eligible:0,sent:0,duplicate:0,skipped:0,failed:0,already_running:false};};
 try{
  process.env.EMAIL_NOTIFICATIONS_ENABLED='false';startRegistrationMailWorker(run);assert.equal(calls,0);
  process.env.EMAIL_NOTIFICATIONS_ENABLED='true';stop=startRegistrationMailWorker(run);await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(registrationMailStatus().started,true);assert.equal(registrationMailStatus().last_run_ok,true);
  startRegistrationMailWorker(run);assert.equal(calls,1);
  await scheduled();await new Promise(setImmediate);assert.equal(calls,2);
  stop();assert.equal(cleared,true);await scheduled();assert.equal(calls,2);assert.equal(registrationMailStatus().started,false);
 }finally{stop?.();global.setTimeout=realSet;global.clearTimeout=realClear;if(saved===undefined)delete process.env.EMAIL_NOTIFICATIONS_ENABLED;else process.env.EMAIL_NOTIFICATIONS_ENABLED=saved;}
});

test('read-only queue delivery skips VALID/OFF, wrong scope, inactive and late reminders; opt-in and dedupe',async()=>{
 const original=process.env.EMAIL_NOTIFICATIONS_ENABLED;
 const sendNever=async()=>assert.fail('No email transport allowed');
 try{
  process.env.EMAIL_NOTIFICATIONS_ENABLED='false';let f=fixture();let r=await deliverRegistrationReminders({...f,send:sendNever});assert.equal(r.enabled,false);assert.equal(f.reads,0);
  r=await deliverRegistrationReminders({...f,dryRun:true,send:sendNever});assert.equal(r.eligible,1);assert.equal(r.sent,0);
  process.env.EMAIL_NOTIFICATIONS_ENABLED='true';
  for(const change of [{emptyQueue:true},{submitDuringAuth:true},{header:{status:'VALID',submitted_at:'2026-11-07T00:00Z'}},{employee:{id:id(4),user_id:id(3),branch_id:id(2),status:'ACTIVE',skill_level:'CREW_LEADER'}},{user:{id:id(3),role:'NV',is_active:false,branch_id:id(2)}},{user:{id:id(3),role:'NV',is_active:true,branch_id:id(99)}},{branch:{status:'INACTIVE'}},{email:null},{expireDuringAuth:true},{latest:{...period,close_at:'2026-11-08T11:00:00+07:00'}}]){
   f=fixture(change);r=await deliverRegistrationReminders({...f,send:sendNever});assert.equal(r.sent,0);assert.equal(r.eligible,0);
  }
  let sends=0;
  for(const header of [null,{status:'DRAFT',submitted_at:null}]){
   f=fixture({header});const send=async mail=>{sends++;assert.equal(mail.to,'fixture@example.invalid');assert.ok(mail.message.endsWith(f.notice.id));return 'sent';};
   r=await deliverRegistrationReminders({...f,send});assert.equal(r.sent,1);
   r=await deliverRegistrationReminders({...f,send});assert.equal(r.sent,0);assert.equal(r.skipped,1);
  }assert.equal(sends,2);
  f=fixture();r=await deliverRegistrationReminders({...f,send:async()=> 'duplicate'});assert.equal(r.duplicate,1);
  f=fixture();let attempts=0;const fail=async()=>{attempts++;throw new MailDeliveryError('MAIL_TIMEOUT_RESULT_UNKNOWN');};
  r=await deliverRegistrationReminders({...f,send:fail});assert.equal(r.failed,1);await deliverRegistrationReminders({...f,send:fail});assert.equal(attempts,1);
  f=fixture({failTable:'registration_submissions'});r=await deliverRegistrationReminders({...f,send:sendNever});assert.equal(r.failed,1);assert.equal(r.sent,0);
 }finally{if(original===undefined)delete process.env.EMAIL_NOTIFICATIONS_ENABLED;else process.env.EMAIL_NOTIFICATIONS_ENABLED=original;}
});
