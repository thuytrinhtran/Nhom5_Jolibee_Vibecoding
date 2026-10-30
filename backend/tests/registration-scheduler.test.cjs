const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('cloud period generator: four-week horizon, eligibility, replay, downtime and year boundaries', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness(),q=(s,p=[])=>h.sql.query(s,p);
 const run=async at=>(await q('SELECT tv2_ensure_registration_periods_at($1::timestamptz) r',[at])).rows[0].r;
 try{
  await q("UPDATE registration_periods SET work_start_date='2026-11-02',work_end_date='2026-11-08'");
  const original=(await q('SELECT to_jsonb(p) r FROM registration_periods p')).rows;
  // Add another eligible branch plus an inactive and an empty branch only inside this fixture.
  await q("INSERT INTO branches(id,name,status) VALUES($1,'Eligible','ACTIVE'),($2,'Inactive','INACTIVE'),($3,'Empty','ACTIVE')",[h.id(21),h.id(22),h.id(23)]);
  await q('INSERT INTO auth.users VALUES($1)',[h.id(24)]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'scheduler_fixture','NV',$2)",[h.id(24),h.id(21)]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Scheduler Fixture',$3,$4,'REGULAR')",[h.id(25),h.id(24),h.id(21),h.id(2)]);
  let r=await run('2026-10-30 14:59+07');assert.equal(r.created,7); // one period already exists
  assert.equal((await run('2026-10-30 15:00+07')).created,0);
  assert.equal((await run('2026-11-01 12:00+07')).created,0);
  assert.equal((await q('SELECT count(*)::int n FROM registration_periods')).rows[0].n,8);
  assert.equal((await q('SELECT count(*)::int n FROM registration_periods WHERE branch_id IN ($1,$2)',[h.id(22),h.id(23)])).rows[0].n,0);
  assert.deepEqual((await q('SELECT to_jsonb(p) r FROM registration_periods p WHERE id=$1',[h.id(8)])).rows,original);
  // Restart/reapply migration doesn't reset existing state; missed runs catch up to current horizon.
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261030_registration_effective_state.sql'),'utf8'));
  r=await run('2026-11-20 15:00+07');assert.equal(r.created,6);
  assert.equal((await run('2026-11-20 15:01+07')).created,0);
  for(const at of ['2026-12-31 23:59+07','2027-01-01 15:00+07','2027-02-26 15:00+07'])await run(at);
  const windows=(await q("SELECT work_start_date,work_end_date,extract(isodow FROM work_start_date)::int dow,extract(isodow FROM open_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int opening,extract(isodow FROM close_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int closing,(open_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time::text ot,(close_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time::text ct,work_end_date-work_start_date duration FROM registration_periods WHERE id<>$1",[h.id(8)])).rows;
  assert.ok(windows.length>8);for(const w of windows){assert.equal(w.dow,1);assert.equal(w.opening,5);assert.equal(w.closing,7);assert.equal(w.ot,'15:00:00');assert.equal(w.ct,'12:00:00');assert.equal(w.duration,6);}
  assert.equal((await q('SELECT count(*)::int n FROM (SELECT branch_id,work_start_date FROM registration_periods GROUP BY 1,2 HAVING count(*)>1) t')).rows[0].n,0);
  for(const role of ['anon','authenticated','service_role'])for(const signature of ['tv2_ensure_registration_periods()','tv2_ensure_registration_periods_at(timestamptz)'])assert.equal((await q('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
  await q('UPDATE registration_schedule_config SET open_iso_day=4');
  const total=(await q('SELECT count(*)::int n FROM registration_periods')).rows[0].n;
  await assert.rejects(run('2027-04-02 15:00+07'),/policy/);
  assert.equal((await q('SELECT count(*)::int n FROM registration_periods')).rows[0].n,total);
 }finally{await h.close();}
});
