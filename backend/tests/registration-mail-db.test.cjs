const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
test('SQL scheduler -> real queue -> mail worker -> durable Apps Script dedupe across backend restart', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness(),q=(s,p=[])=>h.sql.query(s,p);
 const db=require('../dist/config/supabase.js').supabaseAdmin,from=db.from.bind(db),oldAdmin=db.auth.admin.getUserById,savedFlag=process.env.EMAIL_NOTIFICATIONS_ENABLED;
 let at='2026-11-08 11:30:00+07',emails=0;
 try{
  await q("UPDATE registration_periods SET work_start_date='2026-11-09',work_end_date='2026-11-15',open_at='2026-11-06 15:00+07',close_at='2026-11-08 12:00+07',status='OPEN'");
  const legacyConfig=(await q('SELECT enabled FROM registration_automation_config')).rows;
  for(const [n,level,active] of [[10,'NEW',true],[20,'REGULAR',true],[30,'CREW_LEADER',true],[40,'REGULAR',false]]){
   await q('INSERT INTO auth.users VALUES($1)',[h.id(n+3)]);
   await q("INSERT INTO users(id,username,role,branch_id,is_active) VALUES($1,$2,'NV',$3,$4)",[h.id(n+3),'nv_'+n,h.id(1),active]);
   await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Synthetic mail fixture',$3,$4,$5)",[h.id(n+4),h.id(n+3),h.id(1),h.id(2),level]);
  }
  await q("INSERT INTO registration_submissions(period_id,employee_id,status) VALUES($1,$2,'DRAFT')",[h.id(8),h.id(14)]);
  // VALID with zero shifts is an all-OFF submission and must not receive mail.
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID','2026-11-07 10:00+07')",[h.id(8),h.id(24)]);
  const migration=fs.readFileSync(path.resolve(__dirname,'../migrations/20261107_registration_mail_reminders.sql'),'utf8');
  await h.sql.exec(migration);
  const definition=(await q("SELECT pg_get_functiondef('enqueue_registration_mail_reminders()'::regprocedure) d")).rows[0].d;
  const periodsBefore=(await q('SELECT to_jsonb(p) row FROM registration_periods p')).rows;
  const runAt=async time=>{at=time;await h.sql.exec(definition.replaceAll('clock_timestamp()',`timestamptz '${time}'`));return(await q('SELECT enqueue_registration_mail_reminders() r')).rows[0].r;};
  assert.equal((await runAt('2026-11-08 11:29:59+07')).queued_reminders,0);
  assert.equal((await runAt('2026-11-08 11:30:00+07')).queued_reminders,2);
  assert.equal((await runAt('2026-11-08 11:30:01+07')).queued_reminders,0);
  assert.deepEqual((await q('SELECT to_jsonb(p) row FROM registration_periods p')).rows,periodsBefore);
  assert.deepEqual((await q('SELECT enabled FROM registration_automation_config')).rows,legacyConfig);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'enqueue_registration_mail_reminders()','EXECUTE') allowed",[role])).rows[0].allowed,false);
  db.from=table=>{
   if(table!=='notifications')return from(table);
   let type,prefix;
   return{select(){return this},eq(k,v){assert.equal(k,'type');type=v;return this},like(k,v){assert.equal(k,'idempotency_key');prefix=v;return this},order(){return this},async range(a,b){return{data:(await q('SELECT id,recipient_id,title,content,idempotency_key FROM notifications WHERE type=$1 AND idempotency_key LIKE $2 ORDER BY id LIMIT $3 OFFSET $4',[type,prefix,b-a+1,a])).rows,error:null};}};
  };
  db.auth.admin.getUserById=async uid=>({data:{user:{email:uid+'@example.invalid'}},error:null});
  // Execute the actual .gs contract with memory-backed Script Properties only.
  const properties=new Map([['GOOGLE_MAIL_SECRET','fixture']]);
  const box={ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({body:JSON.parse(s),setMimeType(){return this}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),getProperties:()=>Object.fromEntries(properties),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},MailApp:{getRemainingDailyQuota:()=>100,sendEmail(to){assert.ok([h.id(3),h.id(13)].some(id=>to===id+'@example.invalid'));emails++;}}};
  const source=fs.readFileSync(path.resolve(__dirname,'../../docs/google-mail-webapp.gs'),'utf8');
  const send=async mail=>{const context=vm.createContext({...box});vm.runInContext(source,context);const reply=context.doPost({postData:{contents:JSON.stringify({secret:'fixture',...mail})}}).body;assert.equal(reply.success,true);return reply.status;};
  process.env.EMAIL_NOTIFICATIONS_ENABLED='true';
  const modulePath=require.resolve('../dist/services/registration-mail.service.js');
  let worker=require(modulePath);const opts={db,send,now:()=>Date.parse(at)};
  assert.equal((await worker.deliverRegistrationReminders(opts)).sent,2);assert.equal(emails,2);
  delete require.cache[modulePath];worker=require(modulePath);
  assert.equal((await worker.deliverRegistrationReminders(opts)).duplicate,2);assert.equal(emails,2);
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID','2026-11-08 11:31+07')",[h.id(8),h.id(4)]);
  delete require.cache[modulePath];worker=require(modulePath);
  const result=await worker.deliverRegistrationReminders(opts);assert.equal(result.skipped,1);assert.equal(result.duplicate,1);assert.equal(emails,2);
  await runAt('2026-11-08 12:00:00+07');assert.equal((await worker.deliverRegistrationReminders(opts)).sent,0);assert.equal(emails,2);
  await h.sql.exec(fs.readFileSync(path.resolve(__dirname,'../rollbacks/20261107_registration_mail_reminders.sql'),'utf8'));
  assert.equal((await q("SELECT to_regprocedure('enqueue_registration_mail_reminders()') fn")).rows[0].fn,null);
  assert.equal((await q('SELECT count(*)::int n FROM notifications')).rows[0].n,2);
 }finally{db.from=from;db.auth.admin.getUserById=oldAdmin;if(savedFlag===undefined)delete process.env.EMAIL_NOTIFICATIONS_ENABLED;else process.env.EMAIL_NOTIFICATIONS_ENABLED=savedFlag;await h.close();}
});
