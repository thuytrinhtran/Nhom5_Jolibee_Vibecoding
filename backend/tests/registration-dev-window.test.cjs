const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../dist/registrations/dev-test-window.js'),scope=api.DEV_TEST_REGISTRATION_SCOPE;
const env={REGISTRATION_DEV_TEST_MODE:'true',NODE_ENV:'development',SUPABASE_URL:`https://${scope.project}.supabase.co`};
test('registration time exception is opt-in and restricted to the exact development project/branch/period/dates',()=>{
 const p={id:scope.period,branch_id:scope.branch,work_start_date:scope.start,work_end_date:scope.end};
 assert.equal(api.usesDevTestWindow(p,scope.branch,env),true);
 assert.equal(api.usesDevTestWindow(p,scope.branch,{}),false);
 for(const patch of [{id:'79a979cc-8347-48b5-a411-f03bd8aceb92'},{branch_id:'other'},{work_start_date:'2026-11-02'}])assert.equal(api.usesDevTestWindow({...p,...patch},scope.branch,env),false);
 assert.equal(api.usesDevTestWindow(p,'other',env),false);
 for(const patch of [{NODE_ENV:'production'},{SUPABASE_URL:'https://other.supabase.co'}])assert.throws(()=>api.devTestWindowEnabled({...env,...patch}));
});
test('wrong registration period is rejected before any transaction/query',async()=>{
 const old={...process.env};Object.assign(process.env,env);let calls=0;
 try{await assert.rejects(api.saveDevTestRegistration({query:async()=>{calls++;}},'u','79a979cc-8347-48b5-a411-f03bd8aceb92',[],true),e=>e.status===403);assert.equal(calls,0);}
 finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});

test('development override refuses a submitted or published schedule before any registration write',async()=>{
 const before={...process.env};Object.assign(process.env,env);const calls=[];
 const connection={query:async(sql)=>{calls.push(sql);return{rows:sql.startsWith('SELECT id FROM public.schedules')?[{id:'protected-schedule'}]:[]};}};
 try{
  await assert.rejects(api.saveDevTestRegistration(connection,'u',scope.period,[],true),e=>e.status===409);
  assert.ok(calls.includes('LOCK TABLE public.schedules IN SHARE MODE'));
  assert.ok(calls.some(sql=>sql.includes("'PENDING_APPROVAL','APPROVED','PUBLISHED'")));
  assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(sql=>/^(INSERT|DELETE|UPDATE)/.test(sql)));
 }finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});

test('production never opens the development writer, even with the opt-in flag',async()=>{
 const before={...process.env};Object.assign(process.env,env,{NODE_ENV:'production'});let calls=0;
 try{await assert.rejects(api.saveDevTestRegistration({query:async()=>{calls++;return{rows:[]};}},'u',scope.period,[],true),e=>e.status===503);assert.equal(calls,0);}
 finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});

test('missing old-machine credentials produce actionable error before any connection',async()=>{
 const before={...process.env};Object.assign(process.env,env,{REGISTRATION_DEV_PG_CONNECTION_FILE:require('node:path').resolve('tests/nonexistent-dev-connection.json'),REGISTRATION_DEV_PG_CLIENT:require('node:path').resolve('tests/nonexistent-pg-client')});
 try{await assert.rejects(api.persistDevTestRegistration('u',scope.period,[],true),e=>e.status===503&&e.message.includes('RPC Supabase thông thường vẫn kiểm tra thời hạn'));}
 finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
test('isolated PostgreSQL dev registration: closed period, validation, ownership, rollback, and untouched other periods',{skip:process.env.REGISTRATION_DEV_NATIVE_TESTS!=='true'?'Requires disposable loopback-only PostgreSQL':false},async()=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness(),q=(s,p=[])=>h.admin.query(s,p),old={...process.env};
 try{
  const other=await h.fixture(),nv=h.id(501),employee=h.id(502),shift=h.id(503),dept=h.id(504);
  await q("INSERT INTO branches(id,name) VALUES($1,'Scoped local test')",[scope.branch]);await q("INSERT INTO departments(id,name) VALUES($1,'Test')",[dept]);await q('INSERT INTO auth.users VALUES($1)',[nv]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'dev_window_fixture','NV',$2)",[nv,scope.branch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Synthetic test',$3,$4,'REGULAR')",[employee,nv,scope.branch,dept]);
  await q("INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,'Morning','08:00','12:00',$2)",[shift,scope.branch]);
  await q("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) VALUES($1,$2,$3,$4,'2026-10-01','2026-10-02','CLOSED')",[scope.period,scope.branch,scope.start,scope.end]);
  const baseline=(await q('SELECT to_jsonb(r) row FROM shift_registrations r WHERE period_id=$1',[other.period])).rows;
  const pref=[{work_date:scope.start,shift_id:shift}];Object.assign(process.env,env);
  await assert.rejects(q('SELECT save_employee_registration($1,$2,$3::jsonb,true)',[nv,scope.period,JSON.stringify(pref)]));
  assert.equal((await api.saveDevTestRegistration(h.admin,nv,scope.period,pref,true)).registration_status,'VALID');
  assert.equal((await q('SELECT count(*)::int n FROM shift_registrations WHERE period_id=$1',[scope.period])).rows[0].n,1);
  await assert.rejects(api.saveDevTestRegistration(h.admin,nv,scope.period,[...pref,...pref],true),e=>e.status===400);
  await assert.rejects(api.saveDevTestRegistration(h.admin,nv,scope.period,[{...pref[0],work_date:'2026-11-02'}],true),e=>e.status===400);
  await q("UPDATE users SET role='QL' WHERE id=$1",[nv]);await assert.rejects(api.saveDevTestRegistration(h.admin,nv,scope.period,pref,true),e=>e.status===403);await q("UPDATE users SET role='NV' WHERE id=$1",[nv]);
  await q("CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER fail_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_test_audit()");
  await assert.rejects(api.saveDevTestRegistration(h.admin,nv,scope.period,[],true));
  assert.equal((await q('SELECT count(*)::int n FROM shift_registrations WHERE period_id=$1',[scope.period])).rows[0].n,1,'audit failure rolls back replacement');
  assert.deepEqual((await q('SELECT to_jsonb(r) row FROM shift_registrations r WHERE period_id=$1',[other.period])).rows,baseline);
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);await h.close();}
});
