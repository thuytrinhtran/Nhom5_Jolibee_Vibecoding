const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('time-state migration, RPC boundaries, TV3 and existing rows on isolated PostgreSQL', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness(),q=(s,p=[])=>h.sql.query(s,p);
 try{
  const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261030_registration_effective_state.sql'),'utf8');
  // Replay without changing persisted periods or genuine/sample rows.
  await q("INSERT INTO audit_logs(id,entity_id,entity_type,action) VALUES($1,$1,'fixture','TEST')",[h.id(90)]);
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,sample_batch_id) VALUES($1,$2,'DRAFT',$3)",[h.id(8),h.id(4),h.id(90)]);
  const before=(await q('SELECT to_jsonb(h) v FROM registration_submissions h')).rows;
  await h.sql.exec(migration);
  assert.deepEqual((await q('SELECT to_jsonb(h) v FROM registration_submissions h')).rows,before);
  assert.equal((await q('SELECT open_iso_day FROM registration_schedule_config')).rows[0].open_iso_day,5);
  // Audited legacy v2 fixtures remain opt-in samples without rewriting raw data.
  await q("UPDATE registration_submissions SET sample_batch_id=NULL,status='VALID',submitted_at='2026-10-24 10:00+07',updated_at='2026-10-24 10:01+07'");
  await q("INSERT INTO audit_logs(id,entity_id,entity_type,action,change_source,new_data) VALUES($1,$2,'registration_period','TV2_TEST_SEED','SYSTEM',jsonb_build_object('fixture','tv2-test-week-20261026-v1','synthetic',true,'employee_ids',jsonb_build_array($3::uuid)))",[h.id(91),h.id(8),h.id(4)]);
  assert.equal((await q('SELECT sample_batch_id FROM registration_submissions_sourced')).rows[0].sample_batch_id,h.id(91));
  assert.equal((await q('SELECT sample_batch_id FROM registration_submissions')).rows[0].sample_batch_id,null);
  await q('SELECT save_employee_registration($1,$2,$3::jsonb,true)',[h.id(3),h.id(8),'[]']);
  assert.equal((await q('SELECT sample_batch_id FROM registration_submissions_sourced')).rows[0].sample_batch_id,null);

  await q("UPDATE registration_periods SET status='PLANNED',open_at='2026-10-30 15:00+07',close_at='2026-11-01 12:00+07'");
  const definition=(await q("SELECT pg_get_functiondef('save_employee_registration(uuid,uuid,jsonb,boolean)'::regprocedure) d")).rows[0].d;
  for(const [at,status] of [['2026-10-30 14:59+07','PLANNED'],['2026-10-30 15:00+07','OPEN'],['2026-11-01 11:59+07','OPEN'],['2026-11-01 12:00+07','CLOSED']]){
   assert.equal((await q('SELECT registration_effective_status(open_at,close_at,$1::timestamptz) s FROM registration_periods',[at])).rows[0].s,status);
   // Fixed clock exists ONLY in this disposable PostgreSQL function, never production SQL.
   await h.sql.exec(definition.replaceAll('clock_timestamp()',`timestamptz '${at}'`));
   for(const submit of [false,true]){
    const rows=(await q('SELECT to_jsonb(h) v FROM registration_submissions h')).rows;
    const save=()=>q('SELECT save_employee_registration($1,$2,$3::jsonb,$4)',[h.id(3),h.id(8),'[]',submit]);
    if(status==='OPEN')await save();else {await assert.rejects(save());assert.deepEqual((await q('SELECT to_jsonb(h) v FROM registration_submissions h')).rows,rows);}
   }
  }
  // View computes from DB time while retaining original stored PLANNED for diagnostics.
  await q("UPDATE registration_periods SET open_at=now()-interval '1 hour',close_at=now()+interval '1 hour'");
  const view=(await q('SELECT status,stored_status FROM registration_periods_effective')).rows[0];
  assert.deepEqual(view,{status:'OPEN',stored_status:'PLANNED'});
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'save_employee_registration(uuid,uuid,jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }finally{await h.close();}
});
