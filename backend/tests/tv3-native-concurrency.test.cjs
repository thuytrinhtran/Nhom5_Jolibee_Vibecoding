const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const enabled=['TV3_NATIVE_PG_ROOT','TV3_NATIVE_PG_BIN','TV3_NATIVE_PG_CLIENT'].every(k=>process.env[k]);
test('TV3 multi-session PostgreSQL deployment checks',{skip:!enabled?'Provide private native tool paths; never a Supabase URL':false,timeout:120000},async t=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness();const a=await h.connect(),b=await h.connect();
 const opts=(f,snapshot,extra={})=>({snapshot,result:{assignments:[f.assignment]},request:randomUUID(),fingerprint:createHash('sha256').update(JSON.stringify({snapshot,extra})).digest('hex'),...extra});
 const count=async f=>Number((await h.admin.query('SELECT count(*) n FROM schedules WHERE period_id=$1',[f.period])).rows[0].n);
 const baseline=async f=>(await h.call(h.admin,f)).input;
 try{
  const pids=await Promise.all([h.admin,a,b].map(c=>c.query('SELECT pg_backend_pid() pid')));assert.equal(new Set(pids.map(r=>r.rows[0].pid)).size,3);
  await t.test('catalog preflight executes successfully under a READ ONLY transaction',async()=>{
   const fs=require('node:fs'),path=require('node:path');await h.admin.query('BEGIN READ ONLY');
   try{await h.admin.query(fs.readFileSync(path.resolve(__dirname,'../../docs/tv3-deployment-preflight.sql'),'utf8'));}finally{await h.admin.query('ROLLBACK');}
  });
  await t.test('simultaneous creates fail fast, commit once and retry idempotently',async()=>{
   const f=await h.fixture(),snapshot=await baseline(f),first=opts(f,snapshot),competing=opts(f,snapshot);
   await a.query("BEGIN; SET LOCAL statement_timeout='8s'");const saved=await h.call(a,f,first);
   const before=Date.now();await assert.rejects(h.call(b,f,competing),e=>e.code==='55P03');assert.ok(Date.now()-before<1500);assert.equal(await count(f),0);
   await a.query('COMMIT');assert.equal(await count(f),1);
   const replay=await h.call(b,f,{request:first.request,fingerprint:first.fingerprint});assert.equal(replay.reused,true);assert.equal(replay.result.schedule.id,saved.result.schedule.id);
   await assert.rejects(h.call(b,f,competing),/SCHEDULE_EXISTS/);
   assert.equal(Number((await h.admin.query("SELECT count(*) n FROM audit_logs WHERE entity_id=$1",[saved.result.schedule.id])).rows[0].n),1);
  });
  await t.test('competing DRAFT edits preserve one new version and reject stale version',async()=>{
   const f=await h.fixture(),saved=await h.call(h.admin,f,opts(f,await baseline(f))),target=saved.result.schedule.id;
   const snapshot=(await h.call(h.admin,f,{target,version:1})).input,first=opts(f,snapshot,{target,version:1}),competing=opts(f,snapshot,{target,version:1});
   await a.query('BEGIN');const edited=await h.call(a,f,first);await assert.rejects(h.call(b,f,competing),e=>e.code==='55P03');await a.query('COMMIT');
   await assert.rejects(h.call(b,f,competing),e=>e.code==='40001'&&e.message==='SCHEDULE_VERSION_CHANGED');assert.equal(await count(f),2);assert.equal(edited.result.schedule.version,2);assert.equal(edited.result.schedule.schedule_group_id,saved.result.schedule.schedule_group_id);
   assert.equal((await h.admin.query('SELECT status FROM shift_assignments WHERE schedule_id=$1',[target])).rows[0].status,'REPLACED');
  });
  await t.test('TV2 writer wins; save yields and rejects source changed before retry',async()=>{
   const f=await h.fixture(),snapshot=await baseline(f),request=opts(f,snapshot);
   await a.query('BEGIN');await a.query("UPDATE shift_registrations SET status='INVALID' WHERE period_id=$1",[f.period]);
   await assert.rejects(h.call(b,f,request),e=>e.code==='55P03');await a.query('COMMIT');
   await assert.rejects(h.call(b,f,request),e=>e.code==='40001');assert.equal(await count(f),0);
   const refreshed=await baseline(f);assert.equal(refreshed.registrations.length,0);
   const retry=await h.call(b,f,opts(f,refreshed,{result:{assignments:[]}}));assert.equal(retry.result.assigned_count,0);assert.equal(retry.result.shortages[0].missing_count,1);
  });
  await t.test('TV4 status writer wins; draft cannot be edited after submission',async()=>{
   const f=await h.fixture(),saved=await h.call(h.admin,f,opts(f,await baseline(f))),target=saved.result.schedule.id;
   const snapshot=(await h.call(h.admin,f,{target,version:1})).input,request=opts(f,snapshot,{target,version:1});
   await a.query('BEGIN');await a.query("UPDATE schedules SET status='PENDING_APPROVAL' WHERE id=$1",[target]);
   await assert.rejects(h.call(b,f,request),e=>e.code==='55P03');await a.query('COMMIT');
   await assert.rejects(h.call(b,f,request),e=>e.code==='40001'&&e.message==='DRAFT_LOCKED');assert.equal(await count(f),1);
  });
  await t.test('cron inserts other periods while TV3 holds locks; blocked TV2 write times out then retries',async()=>{
   const f=await h.fixture(),other=await h.fixture(),snapshot=await baseline(f);
   await a.query('BEGIN');await h.call(a,f,opts(f,snapshot));
   await b.query("SET statement_timeout='750ms'");
   const generated=await b.query('SELECT tv2_ensure_registration_periods() r');assert.ok(generated.rows[0].r.created>=4);
   await assert.rejects(b.query("UPDATE shift_registrations SET status='VALID' WHERE period_id=$1",[other.period]),e=>e.code==='57014');
   await a.query('COMMIT');await b.query("UPDATE shift_registrations SET status='VALID' WHERE period_id=$1",[other.period]);await b.query('SET statement_timeout=0');
  });
  await t.test('outer statement timeout cancels slow trigger, rolls back edit and releases locks for retry',async()=>{
   const f=await h.fixture(),saved=await h.call(h.admin,f,opts(f,await baseline(f))),target=saved.result.schedule.id;
   const snapshot=(await h.call(h.admin,f,{target,version:1})).input,request=opts(f,snapshot,{target,version:1});
   await h.admin.query("CREATE FUNCTION native_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(10); RETURN NEW; END $$; CREATE TRIGGER native_slow_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION native_slow_audit();");
   await a.query("SET statement_timeout='700ms'");const before=Date.now();await assert.rejects(h.call(a,f,request),e=>e.code==='57014'&&e.message.includes('statement timeout'));assert.ok(Date.now()-before<2000);
   assert.equal(await count(f),1);assert.equal((await b.query('SELECT status FROM shift_assignments WHERE schedule_id=$1',[target])).rows[0].status,'DRAFT');
   await b.query("SET lock_timeout='500ms'; UPDATE shift_registrations SET status='VALID' WHERE period_id='"+f.period+"'");
   await h.admin.query('DROP TRIGGER native_slow_audit ON audit_logs');await a.query('SET statement_timeout=0');
   const retry=await h.call(a,f,request);assert.equal(retry.result.schedule.version,2);assert.equal(await count(f),2);
  });
  await t.test('actual local PostgREST hoists timeout for both persistence and legacy wrapper',{skip:!process.env.TV3_NATIVE_POSTGREST},async()=>{
   const base=await h.gateway(),pending=[];
   await h.admin.query("CREATE FUNCTION gateway_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(10); RETURN NEW; END $$; CREATE TRIGGER gateway_slow_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION gateway_slow_audit();");
   for(const rpc of ['persist_schedule_draft','generate_schedule_draft']){
    const f=await h.fixture(),snapshot=await baseline(f),request=opts(f,snapshot);const before=Date.now();
    const payload={p_period_id:f.period,p_actor_id:f.actor,p_snapshot:snapshot,p_result:request.result,...(rpc==='persist_schedule_draft'?{p_request_id:request.request,p_fingerprint:request.fingerprint}:{})};pending.push({rpc,f,payload});
    const response=await fetch(base+'/rpc/'+rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    const error=await response.json();assert.equal(error.code,'57014');assert.ok(error.message.includes('statement timeout'));const elapsed=Date.now()-before;assert.ok(elapsed>=4000&&elapsed<8000,`${rpc} timeout ${elapsed}ms`);assert.equal(await count(f),0);t.diagnostic(`${rpc}: gateway cancellation ${elapsed}ms; SQLSTATE 57014, rollback verified`);
    assert.equal(Number((await h.admin.query('SELECT count(*) n FROM shift_assignments WHERE employee_id=$1',[f.employee])).rows[0].n),0);
    await b.query("SET lock_timeout='500ms'");await b.query("UPDATE shift_registrations SET status='VALID' WHERE period_id=$1",[f.period]);
   }
   await h.admin.query('DROP TRIGGER gateway_slow_audit ON audit_logs');
   for(const {rpc,f,payload} of pending){
    const send=()=>fetch(base+'/rpc/'+rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const retry=await send();assert.equal(retry.status,200);const result=await retry.json();assert.equal(result.reused,false);assert.equal(await count(f),1);
    const replay=await send();assert.equal(replay.status,200);assert.equal((await replay.json()).reused,true);assert.equal(await count(f),1);
   }
  });
 }finally{await Promise.allSettled([a.query('ROLLBACK'),b.query('ROLLBACK')]);await h.close();}
});
