const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('source snapshots: business changes, legacy drafts, concurrency, idempotency and guarded rollback',{
 skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires disposable loopback PostgreSQL':false,
},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();let server;
 try{
  for(const name of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),branch=h.id(1),department=h.id(2),employee=h.id(4),shift=h.id(5),emptyShift=h.id(6),period=h.id(8),ql=h.id(90),gs=h.id(91),outside=h.id(92),otherEmployee=h.id(93),otherUser=h.id(94),outsideBranch=h.id(95),outsideGs=h.id(96);
  await q('INSERT INTO auth.users VALUES($1),($2),($3),($4)',[ql,gs,outside,otherUser]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'manager','QL',$4),($2,'supervisor','GS',NULL),($3,'other_employee','NV',$4)",[ql,gs,otherUser,branch]);
  await q("INSERT INTO branches(id,name) VALUES($1,'Outside')",[outsideBranch]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'outside_manager','QL',$2)",[outside,outsideBranch]);
  await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,branch]);
  await q('INSERT INTO auth.users VALUES($1)',[outsideGs]);await q("INSERT INTO users(id,username,role) VALUES($1,'outside_supervisor','GS')",[outsideGs]);await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[outsideGs,outsideBranch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Second employee',$3,$4,'REGULAR')",[otherEmployee,otherUser,branch,department]);
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const day=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0].d;
  const secondDay=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  for(const e of [employee,otherEmployee]){
   await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,e]);
   for(const date of [day,secondDay])await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,e,date,shift]);
  }
  for(const [date,s] of [[day,shift],[secondDay,shift],[day,emptyShift]])await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[branch,department,s,date,ql]);
  Object.assign(process.env,{SCHEDULING_DATA_SOURCE:'supabase',TV3_DRAFT_PERSISTENCE_ENABLED:'true',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true'});
  const {previewSchedule}=require('../dist/services/schedule-preview.service.js'),{persistPreview,serverVerifiedPlan}=require('../dist/services/draft-persistence.service.js'),{readDraft}=require('../dist/services/scheduling.service.js');
  const {prepareApprovalHandoff}=require('../dist/services/schedule-review.service.js'),{transitionSchedule,workflowReview}=require('../dist/services/schedule-workflow.service.js');
  const db=require('../dist/config/supabase.js').supabaseAdmin,from=db.from;
  // The isolated SQL adapter has no PostgREST relation expansion. Listing tests
  // need scalar IDs/status only; keep all real route filters and SQL rows.
  db.from=table=>{const query=from(table),select=query.select.bind(query);query.select=fields=>select(table==='schedules'&&fields.includes('branches(')?'*':table==='schedule_approvals'&&fields.includes('users:')?fields.replace(',users:supervisor_id(username)',''):fields);return query;};
  db.auth.getUser=async token=>({data:{user:{id:token==='manager'?ql:token==='supervisor'?gs:token==='outside'?outside:token==='outside-supervisor'?outsideGs:h.id(3)}}});
  server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/schedules/workflow`,headers=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
  let request=200;const actor={id:ql,role:'QL',branch_id:branch},supervisor={id:gs,role:'GS',branch_id:null};
  const transition=(id,a,action,version,extra={})=>transitionSchedule(id,a,{expected_version:version,request_id:h.id(++request),...extra},action);
  const plain=rows=>rows.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
  const migration=name=>h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  const rollback=name=>h.sql.exec(fs.readFileSync(path.join(__dirname,'../rollbacks',name),'utf8'));
  const source=(id,version)=>q('SELECT tv4_schedule_source_state($1,$2,$3) result',[id,branch,version]).then(r=>r.rows[0].result);
  let preview=await previewSchedule(period,branch,{});
  let saved=(await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:plain(preview.result.assignments),request_id:h.id(++request)})).result.schedule;
  const legacy=saved;
  await migration('20261106_tv3_persist_source_snapshot.sql');await migration('20261106_tv3_persist_source_snapshot.sql');await migration('20261106_tv4_submit_staffing_shortage.sql');await migration('20261106_tv4_submit_staffing_shortage.sql');
  assert.deepEqual(await source(legacy.id,1),{source_state:'UNKNOWN',source_reason:'SOURCE_SNAPSHOT_MISSING'});assert.equal((await readDraft(legacy.id,branch)).demand_changed,null);await assert.rejects(transition(legacy.id,actor,'SUBMIT',1),e=>e.code==='SOURCE_SNAPSHOT_MISSING');
  preview=await previewSchedule(period,branch,{schedule_id:legacy.id,expected_version:1,use_saved_assignments:true});
  saved=(await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:plain(preview.result.assignments),expected_version:1,request_id:h.id(++request)},legacy.id)).result.schedule;
  assert.equal(saved.version,2);
  const original=await q("SELECT new_data->'source_snapshot' snapshot FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[saved.id]);assert.ok(original.rows[0].snapshot);assert.equal((await source(saved.id,saved.version)).source_state,'CURRENT');
  const read=await readDraft(saved.id,branch);assert.equal(read.source_state,'CURRENT');assert.equal(read.demand_changed,false);assert.equal(read.generation_snapshot.source_snapshot,undefined);
  // Forward fix is independently guarded and reversible; historical snapshots are not rewritten.
  await migration('20261107_tv4_source_relevance.sql');await migration('20261107_tv4_source_relevance.sql');
  assert.equal((await source(saved.id,saved.version)).source_state,'CURRENT');
  const project=async(input,rows)=>(await q('SELECT tv3_relevant_source_snapshot_v3($1::jsonb,$2::jsonb) value',[JSON.stringify(input),JSON.stringify(rows)])).rows[0].value;
  const business=original.rows[0].snapshot,own=plain(read.assignments),who=own[0].employee_id;
  const dateOffset=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),nextMonday=dateOffset(business.period.work_end_date,1);
  const booking=(employee_id,work_date,shift_id=shift)=>({employee_id,work_date,shift_id,department_id:department});
  const baseProjection=await project(business,own),unrelated=structuredClone(business);unrelated.existing.push(booking(who,dateOffset(nextMonday,1)));
  assert.deepEqual(await project(unrelated,own),baseProjection,'Future week hours do not invalidate a daytime schedule');
  const affected=structuredClone(business);affected.existing.push(booking(who,business.period.work_start_date));assert.notDeepEqual(await project(affected,own),baseProjection);
  const night=h.id(9900),nightInput=structuredClone(business);nightInput.shifts.push({id:night,start_time:'22:00:00',end_time:'09:00:00',is_active:true,branch_id:branch});
  const carry=structuredClone(nightInput);carry.existing.push(booking(who,dateOffset(business.period.work_start_date,-1),night));assert.notDeepEqual(await project(carry,own),await project(nightInput,own),'Previous Sunday overlap must remain a source dependency');
  const sunday=[booking(who,business.period.work_end_date,night)];const overlapping=structuredClone(nightInput);overlapping.existing.push(booking(who,nextMonday));assert.notDeepEqual(await project(overlapping,sunday),await project(nightInput,sunday),'Sunday overnight must detect following Monday overlap');
  const capped=structuredClone(nightInput);capped.employees.find(e=>e.id===who).max_weekly_hours=40;const futureHours=structuredClone(capped);futureHours.existing.push(booking(who,dateOffset(nextMonday,1)));assert.notDeepEqual(await project(futureHours,sunday),await project(capped,sunday),'Next week hours matter for an employee with a cross-week shift');
  const unassigned=structuredClone(capped);unassigned.existing.push(booking(who===employee?otherEmployee:employee,dateOffset(nextMonday,1)));assert.deepEqual(await project(unassigned,sunday),await project(capped,sunday),'Unrelated employee next-week bookings do not matter');
  await q('BEGIN');
  try{
   await q("INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,'Boundary night','22:00','09:00',$2)",[night,branch]);
   const prior=h.id(9901),priorSchedule=h.id(9902);
   await q("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) VALUES($1,$2,$3::date-7,$3::date-1,now()-interval '10 days',now()-interval '8 days','CLOSED')",[prior,branch,business.period.work_start_date]);
   await q("INSERT INTO schedules(id,branch_id,period_id,version,status,created_by) VALUES($1,$2,$3,1,'DRAFT',$4)",[priorSchedule,branch,prior,ql]);
   await q("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source) VALUES($1,$2,$3::date-1,$4,$5,$6,'DRAFT','REGULAR')",[priorSchedule,who,business.period.work_start_date,night,department,branch]);
   assert.equal((await source(saved.id,saved.version)).source_state,'CHANGED');
   await assert.rejects(previewSchedule(period,branch,{schedule_id:saved.id,expected_version:2,use_saved_assignments:true}),e=>e.code==='SHIFT_OVERLAP');
   await assert.rejects(q('SELECT tv4_assert_schedule_checks_v2($1,false)',[saved.id]));
  }finally{await q('ROLLBACK');}
  await rollback('20261107_tv4_source_relevance.sql');await rollback('20261107_tv4_source_relevance.sql');
  assert.deepEqual((await q("SELECT new_data->'source_snapshot' snapshot FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[saved.id])).rows[0].snapshot,business);
  // Re-saving unchanged assignments creates new IDs/versions in the same group.
  await q('BEGIN');
  try{
   let current=saved;const rows=plain(read.assignments),keys=a=>JSON.stringify(plain(a).map(x=>JSON.stringify(x)).sort());
   for(const version of [3,4]){
    const checked=await previewSchedule(period,branch,{schedule_id:current.id,expected_version:current.version,use_saved_assignments:true});assert.equal(keys(checked.result.assignments),keys(rows));
    const body={period_id:period,input_revision:checked.input_revision,assignments:rows,expected_version:current.version,request_id:h.id(++request)};
    const result=await persistPreview(period,branch,ql,body,current.id);const next=result.result.schedule;
    assert.equal(next.version,version);assert.notEqual(next.id,current.id);assert.equal(next.schedule_group_id,saved.schedule_group_id);
    assert.equal((await persistPreview(period,branch,ql,body,current.id)).reused,true);
    const reread=await readDraft(next.id,branch);assert.equal(keys(reread.assignments),keys(rows));assert.equal(reread.source_state,'CURRENT');current=next;
   }
   const checked=await previewSchedule(period,branch,{schedule_id:current.id,expected_version:current.version,use_saved_assignments:true});
   await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]);
   await assert.rejects(persistPreview(period,branch,ql,{period_id:period,input_revision:checked.input_revision,assignments:rows,expected_version:current.version,request_id:h.id(++request)},current.id),e=>e.code==='PREVIEW_STALE');
   assert.equal((await q('SELECT max(version)::int v FROM schedules WHERE period_id=$1',[period])).rows[0].v,4);
   await q("UPDATE shift_registrations SET status='DRAFT' WHERE employee_id=$1",[employee]);
   await assert.rejects(previewSchedule(period,branch,{schedule_id:current.id,expected_version:current.version,use_saved_assignments:true}));
  }finally{await q('ROLLBACK');}
  // Compare business values, not array ordering, assignment IDs or labels.
  const snap=original.rows[0].snapshot,reordered=structuredClone(snap);for(const key of ['employees','shifts','registrations','requirements','existing','registration_provenance'])reordered[key].reverse();reordered.employees.forEach(e=>{e.full_name='Label only';e.skills.reverse();});reordered.shifts.forEach(x=>x.name='Label only');reordered.existing.forEach(x=>x.id='irrelevant-row-id');
  assert.equal((await q('SELECT tv3_normalize_source_snapshot_v2($1::jsonb)=tv3_normalize_source_snapshot_v2($2::jsonb) same',[JSON.stringify(snap),JSON.stringify(reordered)])).rows[0].same,true);
  await q("UPDATE employees SET full_name='Display label only' WHERE id=$1",[employee]);assert.equal((await source(saved.id,saved.version)).source_state,'CURRENT');
  // Corrupt snapshot in a rolled-back test transaction; immutable old audits remain untouched.
  await q('BEGIN');await q("INSERT INTO audit_logs(actor_id,entity_type,entity_id,action,new_data,change_source,created_at) VALUES($1,'schedules',$2,'AUTO_GENERATE',$3::jsonb,'MANUAL',now()+interval '1 second')",[ql,saved.id,JSON.stringify({source_snapshot:{}})]);
  assert.equal((await source(saved.id,saved.version)).source_reason,'SOURCE_SNAPSHOT_INVALID');await assert.rejects(transition(saved.id,actor,'SUBMIT',saved.version),e=>e.code==='SOURCE_SNAPSHOT_INVALID');await q('ROLLBACK');
  const unchanged=await prepareApprovalHandoff(saved.id,branch,ql,{expected_version:saved.version});assert.equal(unchanged.validation.can_submit,true);assert.equal(unchanged.validation.source_state,'CURRENT');assert.equal(unchanged.validation.coverage_complete,false);
  const assertChanged=async()=>{assert.equal((await source(saved.id,saved.version)).source_state,'CHANGED');const v=await prepareApprovalHandoff(saved.id,branch,ql,{expected_version:saved.version});assert.equal(v.validation.input_current,false);assert.equal(v.validation.can_submit,false);await assert.rejects(transition(saved.id,actor,'SUBMIT',saved.version),e=>e.code==='SOURCE_CHANGED');assert.equal((await readDraft(saved.id,branch)).schedule.status,'DRAFT');};
  await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]);await assertChanged();assert.equal((await prepareApprovalHandoff(saved.id,branch,ql,{expected_version:saved.version})).validation.hard_constraints,'PASS');await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1',[shift]);
  const registration=(await q('SELECT id,submitted_at::text submitted_at FROM shift_registrations WHERE employee_id=$1 ORDER BY id LIMIT 1',[employee])).rows[0];
  await q("UPDATE shift_registrations SET status='DRAFT' WHERE id=$1",[registration.id]);await assertChanged();await q("UPDATE shift_registrations SET status='VALID' WHERE id=$1",[registration.id]);
  const header=(await q('SELECT updated_at::text v FROM registration_submissions WHERE employee_id=$1',[employee])).rows[0];await q("UPDATE registration_submissions SET updated_at=updated_at+interval '1 second' WHERE employee_id=$1",[employee]);await assertChanged();await q('UPDATE registration_submissions SET updated_at=$1 WHERE employee_id=$2',[header.v,employee]);
  await q("INSERT INTO employee_skills(employee_id,skill_name,proficiency_level) VALUES($1,'new-skill','CONFIRMED')",[employee]);await assertChanged();await q("DELETE FROM employee_skills WHERE employee_id=$1 AND skill_name='new-skill'",[employee]);
  await q("UPDATE shifts SET end_time='11:30' WHERE id=$1",[shift]);await assertChanged();await q("UPDATE shifts SET end_time='12:00' WHERE id=$1",[shift]);
  assert.equal((await source(saved.id,saved.version)).source_state,'CURRENT');
  const competitor=await h.connect();
  try{
   await q('BEGIN');await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]);
   await assert.rejects(competitor.query('SELECT tv4_transition_schedule_v2($1,$2,$3,$4,$5)',[saved.id,ql,saved.version,'SUBMIT',h.id(++request)]),e=>e.code==='55P03');await q('ROLLBACK');
   // Hold the successful transition transaction open. Source writers cannot pass its locks.
   await q('BEGIN');await transition(saved.id,actor,'SUBMIT',saved.version);await competitor.query("SET lock_timeout='100ms'");
   await assert.rejects(competitor.query('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]),e=>e.code==='55P03');await q('ROLLBACK');
  }finally{await q('ROLLBACK');await competitor.end();}
  // Optional imported-source registry participates in the same lock order.
  await q('CREATE TABLE public.dev_import_batches(id int)');const registryWriter=await h.connect();
  try{await registryWriter.query('BEGIN');await registryWriter.query('INSERT INTO dev_import_batches VALUES(1)');await assert.rejects(transition(saved.id,actor,'SUBMIT',saved.version),e=>e.code==='WORKFLOW_BUSY');await registryWriter.query('ROLLBACK');}
  finally{await registryWriter.end();await q('DROP TABLE public.dev_import_batches');}
  assert.equal((await readDraft(saved.id,branch)).schedule.status,'DRAFT');
  // Manual editing creates another accurately snapshotted version without altering old audit.
  const previous=saved;preview=await previewSchedule(period,branch,{schedule_id:saved.id,expected_version:saved.version,use_saved_assignments:true});
  saved=(await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:plain(preview.result.assignments).slice(0,1),expected_version:previous.version,request_id:h.id(++request)},previous.id)).result.schedule;
  assert.equal(saved.version,3);assert.equal((await source(saved.id,saved.version)).source_state,'CURRENT');assert.equal((await source(legacy.id,1)).source_state,'UNKNOWN');
  await assert.rejects(transition(legacy.id,actor,'SUBMIT',1),e=>e.code==='STALE_SCHEDULE_VERSION');
  const receipt={expected_version:saved.version,request_id:h.id(++request),note:'snapshot verified'};await transitionSchedule(saved.id,actor,receipt,'SUBMIT');
  await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]);assert.equal((await transitionSchedule(saved.id,actor,receipt,'SUBMIT')).reused,true);await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1',[shift]);
  await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[shift]);await assert.rejects(transition(saved.id,supervisor,'APPROVED',saved.version),e=>e.code==='SOURCE_CHANGED');await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1',[shift]);
  await q('BEGIN');assert.equal((await transition(saved.id,supervisor,'APPROVED',saved.version)).schedule.status,'APPROVED');await q('ROLLBACK');
  // Migration/rollback are guarded, repeatable and retain snapshots and schedule status.
  const before=(await q("SELECT oid::regprocedure::text signature,replace(prosrc,chr(13),'') body,prosecdef,proconfig,proacl::text acl FROM pg_proc WHERE oid IN ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure,'public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'::regprocedure,'public.tv4_assert_schedule_v2(uuid)'::regprocedure) ORDER BY 1")).rows;
  await assert.rejects(rollback('20261106_tv3_persist_source_snapshot.sql'),/ROLLBACK_WORKFLOW_FIRST/);await q('ROLLBACK');
  await rollback('20261106_tv4_submit_staffing_shortage.sql');await rollback('20261106_tv4_submit_staffing_shortage.sql');await rollback('20261106_tv3_persist_source_snapshot.sql');await rollback('20261106_tv3_persist_source_snapshot.sql');
  assert.equal((await q("SELECT status FROM schedules WHERE id=$1",[saved.id])).rows[0].status,'PENDING_APPROVAL');assert.ok((await q("SELECT new_data->'source_snapshot' snapshot FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[saved.id])).rows[0].snapshot);
  await migration('20261106_tv3_persist_source_snapshot.sql');await migration('20261106_tv4_submit_staffing_shortage.sql');await migration('20261106_tv4_submit_staffing_shortage.sql');
  const after=(await q("SELECT oid::regprocedure::text signature,replace(prosrc,chr(13),'') body,prosecdef,proconfig,proacl::text acl FROM pg_proc WHERE oid IN ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure,'public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'::regprocedure,'public.tv4_assert_schedule_v2(uuid)'::regprocedure) ORDER BY 1")).rows;assert.deepEqual(after,before);
  const definition=(await q("SELECT pg_get_functiondef('public.tv4_assert_schedule_v2(uuid)'::regprocedure) definition")).rows[0].definition;
  await q(definition.replace('p_schedule,true','p_schedule,false'));
  await assert.rejects(migration('20261106_tv4_submit_staffing_shortage.sql'),/TV4_SOURCE_MIGRATION_REVIEW_REQUIRED/);await q('ROLLBACK');await q(definition);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.tv4_schedule_source_state(uuid,uuid,integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
