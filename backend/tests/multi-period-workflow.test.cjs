const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

test('two consecutive periods 09-15 and 16-22 November: automation, registration, manual edit, draft versions, submit approve publish and isolation',{
 skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires disposable loopback PostgreSQL':false,
},async t=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 const q=(sql,args=[])=>h.sql.query(sql,args);
 try{
  for(const file of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261103_employee_schedule_read.sql','20261106_tv3_persist_source_snapshot.sql','20261106_tv4_submit_staffing_shortage.sql','20261107_tv4_source_relevance.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const branch=h.id(1),dept=h.id(2),nv=h.id(3),employee=h.id(4),shift=h.id(5),emptyShift=h.id(6),ql=h.id(90),gs=h.id(91),otherUser=h.id(94),otherEmployee=h.id(93);
  await q('INSERT INTO auth.users VALUES($1),($2),($3)',[ql,gs,otherUser]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'multi_manager','QL',$4),($2,'multi_supervisor','GS',NULL),($3,'multi_employee','NV',$4)",[ql,gs,otherUser,branch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Second employee',$3,$4,'REGULAR')",[otherEmployee,otherUser,branch,dept]);
  await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,branch]);
  // Freeze only the automation function's clock, inside this disposable cluster.
  await q('DELETE FROM registration_periods');
  await q('UPDATE registration_automation_config SET enabled=true');
  const definition=(await q("SELECT pg_get_functiondef('public.run_registration_automation()'::regprocedure) body")).rows[0].body;
  for(const clock of ['2026-11-06 15:00:00+07','2026-11-13 15:00:00+07']){
   await q(definition.replaceAll('clock_timestamp()',`timestamptz '${clock}'`));
   assert.equal((await q('SELECT run_registration_automation() result')).rows[0].result.created,1);
   assert.equal((await q('SELECT run_registration_automation() result')).rows[0].result.created,0);
  }
  await q(definition);
  const periods=(await q('SELECT id,work_start_date::text start,work_end_date::text finish,open_at,close_at FROM registration_periods WHERE branch_id=$1 ORDER BY work_start_date',[branch])).rows;
  assert.deepEqual(periods.map(p=>[p.start,p.finish]),[['2026-11-09','2026-11-15'],['2026-11-16','2026-11-22']]);
  const next=periods[1];assert.equal(new Date(next.open_at).toISOString(),'2026-11-13T08:00:00.000Z');assert.equal(new Date(next.close_at).toISOString(),'2026-11-15T05:00:00.000Z');
  for(const [clock,status] of [['2026-11-13 14:59:59+07','PLANNED'],['2026-11-13 15:00:00+07','OPEN'],['2026-11-15 11:59:59+07','OPEN'],['2026-11-15 12:00:00+07','CLOSED']])assert.equal((await q('SELECT registration_effective_status($1,$2,$3) s',[next.open_at,next.close_at,clock])).rows[0].s,status);
  Object.assign(process.env,{SCHEDULING_DATA_SOURCE:'supabase',TV3_DRAFT_PERSISTENCE_ENABLED:'true',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true',TV3_WRITE_SCOPE_ENABLED:'false',TV3_WRITE_SCOPE_MODE:'legacy',TV3_TEST_PREVIEW_ENABLED:'false',DEV_IMPORT_ENABLED:'false'});
  const {previewSchedule}=require('../dist/services/schedule-preview.service.js'),{persistPreview}=require('../dist/services/draft-persistence.service.js'),{readDraft}=require('../dist/services/scheduling.service.js');
  const {prepareApprovalHandoff}=require('../dist/services/schedule-review.service.js'),{transitionSchedule}=require('../dist/services/schedule-workflow.service.js'),{saveDemand}=require('../dist/services/staffing-demand.service.js');
  const repository=require('../dist/repositories/registration-summary.repository.js').registrationSummaryRepository();
  // Real demand validation and reads; SQL storage adapter replaces only PostgREST INSERT.
  const demandRepository=new Proxy(repository,{get(target,key){if(key==='saveRequirement')return async(b,p,actor,input,existing)=>{assert.equal(existing,null);return (await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,required_skill_name,sales_forecast_ref,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[b,input.department_id,input.shift_id,input.work_date,input.required_count,input.required_skill_name,input.sales_forecast_ref,actor])).rows[0]};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const actor={id:ql,role:'QL',branch_id:branch},supervisor={id:gs,role:'GS',branch_id:null};let request=500;
  const plain=rows=>rows.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
  const keys=rows=>JSON.stringify(plain(rows).map(row=>JSON.stringify(row)).sort());
  const snapshot=async id=>(await q("SELECT new_data->'source_snapshot' snapshot FROM audit_logs WHERE entity_type='schedules' AND entity_id=$1 AND action='AUTO_GENERATE' ORDER BY created_at DESC LIMIT 1",[id])).rows[0].snapshot;
  const fingerprint=async p=>{
   const result={};for(const [table,filter] of [['schedules','period_id=$1'],['shift_assignments','schedule_id IN (SELECT id FROM schedules WHERE period_id=$1)'],['audit_logs',"entity_type='schedules' AND entity_id IN (SELECT id FROM schedules WHERE period_id=$1)"],['schedule_approvals','schedule_id IN (SELECT id FROM schedules WHERE period_id=$1)'],['shift_registrations','period_id=$1'],['registration_submissions','period_id=$1'],['staffing_requirements','branch_id=$2 AND work_date BETWEEN (SELECT work_start_date FROM registration_periods WHERE id=$1) AND (SELECT work_end_date FROM registration_periods WHERE id=$1)']])result[table]=(await q(`SELECT count(*)::int n,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) hash FROM ${table} t WHERE ${filter}`,table==='staffing_requirements'?[p,branch]:[p])).rows[0];return result;
  };
  const results=[];let oldFingerprint;
  for(const period of periods){
   const secondDay=new Date(Date.parse(period.start+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   const preferences=[period.start,secondDay].map(work_date=>({work_date,shift_id:shift}));
   await q("UPDATE registration_periods SET open_at=now()+interval '1 day',close_at=now()+interval '2 days',status='OPEN' WHERE id=$1",[period.id]);
   await assert.rejects(q('SELECT save_employee_registration($1,$2,$3::jsonb,true)',[nv,period.id,JSON.stringify(preferences)]));
   // Advance through the registration window without changing the host clock.
   await q("UPDATE registration_periods SET open_at=now()-interval '1 hour',close_at=now()+interval '1 hour',status='PLANNED' WHERE id=$1",[period.id]);
   for(const user of [nv,otherUser]){
    const submitted=(await q('SELECT save_employee_registration($1,$2,$3::jsonb,true) result',[user,period.id,JSON.stringify(preferences)])).rows[0].result;assert.equal(submitted.registration_status,'VALID');
   }
   if(period===next)await assert.rejects(q('SELECT save_employee_registration($1,$2,$3::jsonb,true)',[nv,period.id,JSON.stringify([{work_date:periods[0].start,shift_id:shift}])]));
   for(const [work_date,shift_id] of [[period.start,shift],[secondDay,shift],[period.start,emptyShift]])await saveDemand(period.id,branch,ql,{work_date,shift_id,department_id:dept,required_count:1,required_skill_name:null,sales_forecast_ref:null,expected_updated_at:null},demandRepository);
   await assert.rejects(saveDemand(period.id,branch,ql,{work_date:'2026-11-23',shift_id:shift,department_id:dept,required_count:1,required_skill_name:null,sales_forecast_ref:null,expected_updated_at:null},demandRepository),e=>e.code==='DEMAND_OUTSIDE_PERIOD');
   await assert.rejects(previewSchedule(period.id,branch,{}),e=>e.code==='PERIOD_NOT_CLOSED');
   await q("UPDATE registration_periods SET open_at=now()-interval '2 days',close_at=now()-interval '1 day',status='OPEN' WHERE id=$1",[period.id]);
   await assert.rejects(q('SELECT save_employee_registration($1,$2,$3::jsonb,false)',[nv,period.id,JSON.stringify(preferences)]));
   let preview=await previewSchedule(period.id,branch,{});assert.equal(preview.period.status,'CLOSED');assert.equal(preview.result.assignments.length,2);assert.equal(preview.result.shortages.reduce((n,s)=>n+s.missing_count,0),1);
   const first=(await persistPreview(period.id,branch,ql,{period_id:period.id,input_revision:preview.input_revision,assignments:plain(preview.result.assignments),request_id:h.id(++request)})).result.schedule;assert.equal(first.version,1);
   const initialSnapshot=await snapshot(first.id);
   preview=await previewSchedule(period.id,branch,{schedule_id:first.id,expected_version:1,use_saved_assignments:true});
   const edited=plain(preview.result.assignments).map(a=>({...a,employee_id:a.employee_id===employee?otherEmployee:employee}));assert.notEqual(keys(edited),keys(preview.result.assignments));
   preview=await previewSchedule(period.id,branch,{schedule_id:first.id,expected_version:1,input_revision:preview.input_revision,assignments:edited});
   let saved=(await persistPreview(period.id,branch,ql,{period_id:period.id,input_revision:preview.input_revision,assignments:edited,expected_version:1,request_id:h.id(++request)},first.id)).result.schedule;
   assert.equal(saved.version,2);assert.equal(saved.schedule_group_id,first.schedule_group_id);assert.notEqual(saved.id,first.id);assert.equal(keys((await readDraft(saved.id,branch)).assignments),keys(edited));assert.deepEqual(await snapshot(first.id),initialSnapshot);
   const savedSnapshot=await snapshot(saved.id);assert.equal(savedSnapshot.period.id,period.id);assert.ok(savedSnapshot.registrations.every(a=>a.work_date>=period.start&&a.work_date<=period.finish));assert.ok(savedSnapshot.requirements.every(a=>a.work_date>=period.start&&a.work_date<=period.finish));
   if(period===next){
    await assert.rejects(prepareApprovalHandoff(saved.id,branch,ql,{expected_version:1}),e=>e.code==='SCHEDULE_VERSION_CHANGED');
    const ownBefore=await readDraft(saved.id,branch);assert.equal(ownBefore.source_state,'CURRENT');
    await q('BEGIN');try{await q('UPDATE staffing_requirements SET required_count=required_count+1 WHERE branch_id=$1 AND work_date=$2',[branch,periods[0].start]);assert.equal((await readDraft(saved.id,branch)).source_state,'CURRENT');}finally{await q('ROLLBACK');}
    await q('BEGIN');try{await q('UPDATE staffing_requirements SET required_count=2 WHERE branch_id=$1 AND work_date=$2 AND shift_id=$3',[branch,period.start,shift]);const handoff=await prepareApprovalHandoff(saved.id,branch,ql,{expected_version:2});assert.equal(handoff.validation.source_state,'CHANGED');assert.equal(handoff.validation.can_submit,false);await assert.rejects(transitionSchedule(saved.id,actor,{expected_version:2,request_id:h.id(++request)},'SUBMIT'),e=>e.code==='SOURCE_CHANGED');}finally{await q('ROLLBACK');}
   }
   const handoff=await prepareApprovalHandoff(saved.id,branch,ql,{expected_version:2});assert.equal(handoff.validation.can_submit,true);assert.equal(handoff.validation.coverage_complete,false);assert.equal(handoff.validation.source_state,'CURRENT');
   const beforeCount=(await q('SELECT count(*)::int n FROM schedules WHERE period_id=$1',[period.id])).rows[0].n;
   await assert.rejects(transitionSchedule(saved.id,supervisor,{expected_version:2,request_id:h.id(++request)},'SUBMIT'),e=>e.status===403);
   for(const [action,who] of [['SUBMIT',actor],['APPROVED',supervisor],['PUBLISH',actor]]){
    const body={expected_version:2,request_id:h.id(++request),...(action==='PUBLISH'?{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()}:{})};
    const result=await transitionSchedule(saved.id,who,body,action);assert.equal(result.schedule.id,saved.id);assert.equal(result.schedule.version,2);assert.equal((await transitionSchedule(saved.id,who,body,action)).reused,true);
   }
   assert.equal((await q('SELECT count(*)::int n FROM schedules WHERE period_id=$1',[period.id])).rows[0].n,beforeCount);
   assert.equal((await readDraft(saved.id,branch)).schedule.status,'PUBLISHED');assert.deepEqual(await snapshot(saved.id),savedSnapshot);
   const visible=(await q('SELECT employee_schedule_week($1,$2) result',[nv,period.start])).rows[0].result;
   assert.ok(visible.assignments.length>0);assert.ok(visible.assignments.every(a=>a.work_date>=period.start&&a.work_date<=period.finish));
   results.push({period:period.start,schedule_id:saved.id,version:saved.version,status:'PUBLISHED',required:3,assigned:2,missing:1,schedule_group_id:saved.schedule_group_id});
   if(period!==next)oldFingerprint=await fingerprint(period.id);else assert.deepEqual(await fingerprint(periods[0].id),oldFingerprint,'Second period must not overwrite old schedules, assignments, audit, approvals, registrations or demand');
  }
  assert.notEqual(results[0].schedule_group_id,results[1].schedule_group_id);assert.equal((await readDraft(results[0].schedule_id,branch)).source_state,'CURRENT');
  const {draftWriteScopeAllowed}=require('../dist/services/draft-write-scope.js');const MANUAL_TEST_PERIOD='7f48f53e-d707-4a32-9f15-eb32aeb0095a';
  const env={NODE_ENV:'development',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_SCOPE_MODE:'manual-test',TV3_WRITE_PROJECT_REF:'wlbpprpiieonjrqglicv',SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co',TV3_WRITE_BRANCH_ID:'11111111-1111-1111-1111-111111111111',TV3_WRITE_PERIOD_ID:MANUAL_TEST_PERIOD};
  assert.equal(draftWriteScopeAllowed(MANUAL_TEST_PERIOD,env.TV3_WRITE_BRANCH_ID,env),true);assert.equal(draftWriteScopeAllowed(next.id,env.TV3_WRITE_BRANCH_ID,env),false);assert.equal(draftWriteScopeAllowed(next.id,env.TV3_WRITE_BRANCH_ID,{...env,TV3_WRITE_PERIOD_ID:next.id}),true);
  t.diagnostic(JSON.stringify({result:'PASS',shared_supabase_contacted:false,periods:results,old_period_unchanged:true,previous_published_source_state:(await readDraft(results[0].schedule_id,branch)).source_state,manual_test_blocks_next_period:true,simulation:'Only isolated period windows and automation clock advanced; no host clock or shared configuration changed'}));
 }finally{await h.close();}
});
