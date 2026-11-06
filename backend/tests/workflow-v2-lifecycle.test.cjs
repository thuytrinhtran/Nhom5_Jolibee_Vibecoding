const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('TV3/TV4 lifecycle on disposable PostgreSQL: submit reject revise approve publish, rollback and locks',{
 skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires isolated native PostgreSQL; never Supabase':false,
},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 let server;
 const old={draft:process.env.TV3_DRAFT_PERSISTENCE_ENABLED,workflow:process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED,source:process.env.SCHEDULING_DATA_SOURCE};
 try{
  for(const name of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261106_tv4_staffing_warnings.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),branch=h.id(1),ql=h.id(90),gs=h.id(91),period=h.id(8),employee=h.id(4),shift=h.id(5),department=h.id(2);
  await q('INSERT INTO auth.users VALUES($1),($2)',[ql,gs]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'manager','QL',$3),($2,'supervisor','GS',NULL)",[ql,gs,branch]);
  await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,branch]);
  const outside=h.id(92),outsideBranch=h.id(93);
  await q('INSERT INTO auth.users VALUES($1)',[outside]);await q("INSERT INTO branches(id,name) VALUES($1,'Outside branch')",[outsideBranch]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'outside_manager','QL',$2)",[outside,outsideBranch]);
  await q("UPDATE employees SET skill_level='NEW' WHERE id=$1",[employee]);
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const day=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0].d;
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
  await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,employee,day,shift]);
  await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[branch,department,shift,day,ql]);
  process.env.SCHEDULING_DATA_SOURCE='supabase';process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED='true';
  const {previewSchedule}=require('../dist/services/schedule-preview.service.js'),{persistPreview}=require('../dist/services/draft-persistence.service.js'),{readDraft}=require('../dist/services/scheduling.service.js');
  const {transitionSchedule,workflowReview}=require('../dist/services/schedule-workflow.service.js');
  let next=200;
  const manager={id:ql,role:'QL',branch_id:branch},supervisor={id:gs,role:'GS',branch_id:null};
  const db=require('../dist/config/supabase.js').supabaseAdmin;
  db.auth.getUser=async token=>({data:{user:{id:token==='manager'?ql:token==='supervisor'?gs:h.id(3)}},error:null});
  server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const post=(schedule,path,body,token)=>fetch(`http://127.0.0.1:${server.address().port}/api/schedules/workflow/${schedule}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const transition=(id,actor,action,version,extra={})=>transitionSchedule(id,actor,{expected_version:version,request_id:h.id(++next),...extra},action);
  let preview=await previewSchedule(period,branch,{});
  const first=await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})),request_id:h.id(++next)});
  const id=first.result.schedule.id;
  const reviewed=await workflowReview(id,branch,1);assert.equal(reviewed.ready,true);assert.equal(reviewed.validation.coverage[0].missing_experienced_count,1);
  await assert.rejects(transition(id,{id:outside,role:'QL',branch_id:branch},'SUBMIT',1),e=>e.status===403);
  await assert.rejects(transition(id,{id:ql,role:'GS',branch_id:null},'APPROVED',1),e=>e.status===403);
  const competitor=await h.connect();
  await q('BEGIN');await q('LOCK TABLE schedules IN SHARE ROW EXCLUSIVE MODE');
  try{await assert.rejects(competitor.query('SELECT tv4_transition_schedule_v2($1,$2,1,$3,$4)',[id,ql,'SUBMIT',h.id(++next)]),e=>e.code==='55P03');}
  finally{await q('ROLLBACK');await competitor.end();}
  assert.equal((await readDraft(id,branch)).schedule.status,'DRAFT');
  await assert.rejects(transition(id,manager,'PUBLISH',1,{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()}),e=>e.code==='INVALID_SCHEDULE_STATUS');
  await assert.rejects(transition(id,supervisor,'SUBMIT',1),e=>e.status===403);
  const submitBody={expected_version:1,request_id:h.id(++next),note:'first submit'};
  assert.equal((await post(id,'submit',submitBody,null)).status,401);
  assert.equal((await post(id,'submit',submitBody,'employee')).status,403);
  assert.equal((await post(id,'submit',{...submitBody,actor_id:gs},'manager')).status,400);
  const response=await post(id,'submit',submitBody,'manager');assert.equal(response.status,200);
  const submitted=await response.json();assert.equal(submitted.schedule.status,'PENDING_APPROVAL');
  assert.equal((await transitionSchedule(id,manager,submitBody,'SUBMIT')).reused,true);
  await assert.rejects(transitionSchedule(id,manager,{...submitBody,note:'different'},'SUBMIT'),e=>e.code==='REQUEST_CONFLICT');
  await assert.rejects(previewSchedule(period,branch,{schedule_id:id,expected_version:1,use_saved_assignments:true}),e=>e.code==='DRAFT_LOCKED');
  await assert.rejects(transition(id,supervisor,'NEEDS_REVISION',1,{reason:'  '}),e=>e.code==='REASON_REQUIRED');
  await h.sql.exec("CREATE FUNCTION workflow_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='NEEDS_REVISION' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER workflow_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION workflow_audit_failure();");
  await assert.rejects(transition(id,supervisor,'NEEDS_REVISION',1,{reason:'Revise'}));
  assert.equal((await q('SELECT count(*)::int n FROM schedule_approvals')).rows[0].n,0);assert.equal((await readDraft(id,branch)).schedule.status,'PENDING_APPROVAL');
  await h.sql.exec('DROP TRIGGER workflow_audit_failure ON audit_logs');
  await transition(id,supervisor,'NEEDS_REVISION',1,{reason:'Please revise'});
  preview=await previewSchedule(period,branch,{schedule_id:id,expected_version:1,use_saved_assignments:true});
  const second=await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})),expected_version:1,request_id:h.id(++next)},id);
  const newer=second.result.schedule.id;assert.equal(second.result.schedule.version,2);
  assert.equal((await readDraft(id,branch)).schedule.status,'NEEDS_REVISION');
  assert.equal((await q('SELECT reason FROM schedule_approvals WHERE schedule_id=$1',[id])).rows[0].reason,'Please revise');
  await assert.rejects(transition(id,manager,'SUBMIT',1),e=>e.code==='STALE_SCHEDULE_VERSION');
  await transition(newer,manager,'SUBMIT',2);
  const decisions=await Promise.allSettled([transition(newer,supervisor,'APPROVED',2),transition(newer,supervisor,'NEEDS_REVISION',2,{reason:'Competing'})]);
  assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
  // Whichever concurrent decision wins is immutable. If rejected, create v3.
  let latest=(await readDraft(newer,branch)).schedule;
  if(latest.status==='NEEDS_REVISION'){
   preview=await previewSchedule(period,branch,{schedule_id:newer,expected_version:2,use_saved_assignments:true});
   latest=(await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})),expected_version:2,request_id:h.id(++next)},newer)).result.schedule;
   await transition(latest.id,manager,'SUBMIT',latest.version);await transition(latest.id,supervisor,'APPROVED',latest.version);
  }
  // Actual source drift is revalidated before publication, not trusted from UI.
  await q("UPDATE staffing_requirements SET required_skill_name='Unavailable required skill'");
  await assert.rejects(transition(latest.id,manager,'PUBLISH',latest.version,{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()}),e=>e.code==='HARD_CONSTRAINT_FAILED');
  await q('UPDATE staffing_requirements SET required_skill_name=NULL,required_count=2');
  const shortageReview=await workflowReview(latest.id,branch,latest.version);assert.equal(shortageReview.ready,true);assert.equal(shortageReview.validation.coverage_complete,false);
  const published=await transition(latest.id,manager,'PUBLISH',latest.version,{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()});assert.equal(published.schedule.status,'PUBLISHED');
  assert.equal((await q('SELECT status FROM shift_assignments WHERE schedule_id=$1',[latest.id])).rows[0].status,'ACTIVE');
  await assert.rejects(transition(latest.id,supervisor,'APPROVED',latest.version),e=>e.code==='INVALID_SCHEDULE_STATUS');
  await assert.rejects(q('UPDATE schedule_approvals SET reason=$1 WHERE schedule_id=$2',['erase',id]),/APPROVAL_HISTORY_IMMUTABLE/);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)','EXECUTE') v",[role])).rows[0].v,false);
  assert.ok((await q("SELECT count(*)::int n FROM audit_logs WHERE new_data->>'rpc_version'='tv4.v2'")).rows[0].n>=5);
  assert.equal((await q("SELECT has_function_privilege('service_role','public.tv4_decide_schedule(uuid,uuid,varchar,text)','EXECUTE') v")).rows[0].v,false);
 }finally{
  if(server)await new Promise(r=>server.close(r));
  for(const [key,value] of Object.entries({TV3_DRAFT_PERSISTENCE_ENABLED:old.draft,TV4_WORKFLOW_PERSISTENCE_ENABLED:old.workflow,SCHEDULING_DATA_SOURCE:old.source})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await h.close();
 }
});
