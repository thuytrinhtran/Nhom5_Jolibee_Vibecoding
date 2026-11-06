const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261106_tv4_staffing_warnings.sql'),'utf8');
const original=fs.readFileSync(path.join(__dirname,'../migrations/20261102_tv4_workflow_v2.sql'),'utf8');
const body=original.match(/CREATE FUNCTION public\.tv4_assert_schedule_v2\(p_schedule uuid\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)[1];
const hash=text=>createHash('md5').update(text.replace(/\r/g,'').replace(/\s+/g,' ')).digest('hex');

test('staffing migration changes only the coverage lower bound and retains a guarded, private SQL helper',()=>{
 const next=body.replace('r.required_count<>','r.required_count<').replace("RAISE EXCEPTION 'COVERAGE_INCOMPLETE'","RAISE EXCEPTION 'DEMAND_EXCEEDED'");
 assert.ok(migration.includes(hash(body)));assert.ok(migration.includes(hash(next)));
 assert.match(migration,/current_user<>'postgres'/);assert.match(migration,/pg_get_userbyid\(p.proowner\)='postgres' AND NOT p.prosecdef/);
 assert.match(migration,/TV4_STAFFING_POLICY_REVIEW_REQUIRED/);assert.match(migration,/BEGIN;[\s\S]*COMMIT;/);
 assert.ok(migration.includes("replace(definition,'r.required_count<>','r.required_count<')"));
 assert.ok(migration.includes("replace(definition,'RAISE EXCEPTION ''COVERAGE_INCOMPLETE''','RAISE EXCEPTION ''DEMAND_EXCEEDED''')"));
 assert.equal(next.replace('r.required_count<','r.required_count<>').replace("RAISE EXCEPTION 'DEMAND_EXCEEDED'","RAISE EXCEPTION 'COVERAGE_INCOMPLETE'"),body);
 assert.ok(!/^\s*(GRANT|REVOKE|INSERT|UPDATE|DELETE|ALTER TABLE)\b/im.test(migration));
});

const native=['TV3_NATIVE_PG_ROOT','TV3_NATIVE_PG_BIN','TV3_NATIVE_PG_CLIENT'].every(k=>process.env[k]);
test('staffing policy on disposable PostgreSQL: shortage/balanced/surplus submit approve publish and hard excess rejection',{
 skip:!native?'Requires disposable loopback PostgreSQL; never shared Supabase':false,timeout:120000,
},async t=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness();
 try{
  for(const file of ['20261029_tv4_schedule_workflow.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql'])
   await h.admin.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const metadata=async()=>((await h.admin.query("SELECT proowner::text,prosecdef,proacl::text,proconfig FROM pg_proc WHERE oid='public.tv4_assert_schedule_v2(uuid)'::regprocedure")).rows[0]);
  const before=await metadata();await h.admin.query(migration);assert.deepEqual(await metadata(),before);
  await h.admin.query(migration);assert.deepEqual(await metadata(),before);
  const {generateSchedule}=require('../dist/services/scheduling.engine.js');
  let sequence=6000;
  async function fixture(required,eligible){
   const f=await h.fixture();await h.admin.query('UPDATE staffing_requirements SET required_count=$1 WHERE branch_id=$2',[required,f.branch]);
   const gs=h.id(++sequence);await h.admin.query('INSERT INTO auth.users VALUES($1)',[gs]);
   await h.admin.query("INSERT INTO users(id,username,role) VALUES($1,$2,'GS')",[gs,'policy_gs_'+sequence]);
   await h.admin.query('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,f.branch]);
   const extras=[];
   for(let i=1;i<eligible;i++){
    const user=h.id(++sequence),employee=h.id(++sequence);extras.push(employee);
    await h.admin.query('INSERT INTO auth.users VALUES($1)',[user]);
    await h.admin.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,$2,'NV',$3)",[user,'policy_nv_'+sequence,f.branch]);
    await h.admin.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,max_weekly_hours) VALUES($1,$2,'Synthetic policy employee',$3,$4,'REGULAR',40)",[employee,user,f.branch,f.department]);
    await h.admin.query("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[f.period,employee]);
    await h.admin.query("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,'2026-10-26',$3,'VALID',now())",[f.period,employee,f.shift]);
   }
   const input=(await h.call(h.admin,f)).input,result=generateSchedule(input);
   const saved=(await h.call(h.admin,f,{snapshot:input,result,request:randomUUID(),fingerprint:'a'.repeat(64)})).result;
   return {f,gs,saved,extras};
  }
  async function move(s,actor,action){return (await h.admin.query('SELECT public.tv4_transition_schedule_v2($1,$2,1,$3,$4,NULL,$5) r',
   [s.saved.schedule.id,actor,action,randomUUID(),action==='PUBLISH'?new Date(Date.now()+86400000).toISOString():null])).rows[0].r;}
  for(const [name,required,eligible] of [['shortage',2,1],['balanced',1,1],['surplus candidates',1,3]])
   await t.test(name,async()=>{
    const s=await fixture(required,eligible);assert.ok(s.saved.assigned_count<=required);
    assert.equal((await move(s,s.f.actor,'SUBMIT')).schedule.status,'PENDING_APPROVAL');
    assert.equal((await move(s,s.gs,'APPROVED')).schedule.status,'APPROVED');
    assert.equal((await move(s,s.f.actor,'PUBLISH')).schedule.status,'PUBLISHED');
   });
  await t.test('actual over-assignment still fails in SQL',async()=>{
   const s=await fixture(1,2),assigned=s.saved.assignments[0].employee_id;
   const extra=[s.f.employee,...s.extras].find(id=>id!==assigned);
   await h.admin.query("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source) VALUES($1,$2,'2026-10-26',$3,$4,$5,'DRAFT','REGULAR')",[s.saved.schedule.id,extra,s.f.shift,s.f.department,s.f.branch]);
   await assert.rejects(move(s,s.f.actor,'SUBMIT'),/DEMAND_EXCEEDED/);
   assert.equal((await h.admin.query('SELECT status FROM schedules WHERE id=$1',[s.saved.schedule.id])).rows[0].status,'DRAFT');
  });
  await t.test('unknown SQL helper is refused instead of overwritten',async()=>{
   await h.admin.query('BEGIN');
   try{await h.admin.query("CREATE OR REPLACE FUNCTION public.tv4_assert_schedule_v2(p_schedule uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$");
    await assert.rejects(h.admin.query(migration),/TV4_STAFFING_POLICY_REVIEW_REQUIRED/);
   }finally{await h.admin.query('ROLLBACK');}
  });
 }finally{await h.close();}
});
