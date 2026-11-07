const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('isolated SQL: regenerate save v2 submit shortage, supervisor scope, conflicts, shortage approval publication and employee visibility',{
 skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires disposable loopback PostgreSQL':false,
},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();let server;
 try{
  for(const name of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261103_employee_schedule_read.sql','20261106_tv3_persist_source_snapshot.sql','20261106_tv4_submit_staffing_shortage.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
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
  let preview=await previewSchedule(period,branch,{});
  const first=await persistPreview(period,branch,ql,{period_id:period,input_revision:preview.input_revision,assignments:plain(preview.result.assignments),request_id:h.id(++request)});
  const target=first.result.schedule;
  preview=await previewSchedule(period,branch,{schedule_id:target.id,expected_version:1});
  const alternative=await previewSchedule(period,branch,{schedule_id:target.id,expected_version:1,input_revision:preview.input_revision,assignments:plain(preview.result.assignments),alternative_history:[plain(preview.result.assignments)]});
  assert.equal(alternative.alternative.status,'FOUND');
  const second=await persistPreview(period,branch,ql,{period_id:period,input_revision:alternative.input_revision,assignments:plain(alternative.result.assignments),expected_version:1,request_id:h.id(++request)},target.id);let s=second.result.schedule;
  assert.equal(s.version,2);assert.deepEqual(plain((await readDraft(s.id,branch)).assignments).sort((a,b)=>a.work_date.localeCompare(b.work_date)),plain(alternative.result.assignments).sort((a,b)=>a.work_date.localeCompare(b.work_date)));
  // Reopen the persisted draft: read/preparation/submission must not create a version.
  const versionsBeforeSubmit=(await q('SELECT count(*)::int n FROM schedules WHERE period_id=$1 AND branch_id=$2',[period,branch])).rows[0].n;
  const reopened=await readDraft(s.id,branch);assert.equal(reopened.schedule.id,s.id);assert.equal(reopened.schedule.version,2);assert.equal(reopened.source_state,'CURRENT');
  const handoff=await prepareApprovalHandoff(reopened.schedule.id,branch,ql,{expected_version:reopened.schedule.version});assert.equal(handoff.validation.can_submit,true);assert.equal(handoff.validation.coverage_complete,false);assert.ok(handoff.validation.warnings.some(w=>w.code==='STAFFING_SHORTAGE'));assert.equal(handoff.validation.issues.length,0);assert.equal((await workflowReview(s.id,branch,2)).ready,true);
  await assert.rejects(transition(target.id,actor,'SUBMIT',1),e=>e.code==='STALE_SCHEDULE_VERSION');
  await assert.rejects(transition(s.id,actor,'SUBMIT',1),e=>e.code==='STALE_SCHEDULE_VERSION');
  await assert.rejects(transition(s.id,{id:outside,role:'QL',branch_id:outsideBranch},'SUBMIT',2),e=>e.status===403);
  await assert.rejects(transition(s.id,supervisor,'SUBMIT',2),e=>e.status===403);
  assert.equal((await fetch(base+'/'+s.id+'/submit',{method:'POST',headers:headers('employee'),body:JSON.stringify({expected_version:2,request_id:h.id(++request)})})).status,403);
  await q('UPDATE staffing_requirements SET required_count=0 WHERE shift_id=$1 AND work_date=$2',[shift,day]);
  await assert.rejects(transition(s.id,actor,'SUBMIT',2));assert.equal((await readDraft(s.id,branch)).schedule.status,'DRAFT');
  await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1 AND work_date=$2',[shift,day]);
  const body={expected_version:2,request_id:h.id(++request),note:'Review staffing shortage'};
  // Use the actual frontend HTTP client: TV4's response has no TV3 status envelope.
  const ts=require('typescript'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../../frontend/src/services/scheduling.service.ts'),'utf8').replace('import.meta.env',JSON.stringify({VITE_API_URL:base.replace('/schedules/workflow','')}));
  const clientModule={exports:{}};
  class ClientError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:clientModule.exports,module:clientModule,AbortSignal,fetch:async(url,options)=>{assert.ok(url.startsWith(`http://127.0.0.1:${server.address().port}/api/`));return fetch(url,options);},require:id=>{assert.equal(id,'./auth.service');return{ApiError:ClientError,authService:{getMe:async()=>{},getStoredToken:()=> 'manager'}};}});
  const client=clientModule.exports.schedulingService;
  const prepared=await client.prepareHandoff(s.id,2,body.note);assert.equal(prepared.validation.can_submit,true);assert.equal(prepared.validation.source_state,'CURRENT');
  const response=await client.submitApproval(s.id,2,body.note,body.request_id);assert.equal(response.schedule.status,'PENDING_APPROVAL');assert.equal(response.schedule.id,s.id);assert.equal(response.schedule.version,2);
  assert.equal((await client.submitApproval(s.id,2,body.note,body.request_id)).reused,true);
  assert.equal((await transitionSchedule(s.id,actor,body,'SUBMIT')).reused,true);
  const submittedDraft=await readDraft(s.id,branch);assert.equal(submittedDraft.schedule.id,reopened.schedule.id);assert.equal(submittedDraft.schedule.version,reopened.schedule.version);
  assert.equal((await q('SELECT count(*)::int n FROM schedules WHERE period_id=$1 AND branch_id=$2',[period,branch])).rows[0].n,versionsBeforeSubmit);
  const pending=await fetch(base+'?view=pending',{headers:headers('supervisor')});assert.equal(pending.status,200);assert.ok((await pending.json()).schedules.some(row=>row.id===s.id));
  assert.equal((await fetch(base+'/'+s.id+'/review',{headers:headers('outside')})).status,403);
  const outsidePending=await fetch(base+'?view=pending',{headers:headers('outside-supervisor')});assert.equal(outsidePending.status,200);assert.deepEqual((await outsidePending.json()).schedules,[]);
  assert.equal((await fetch(base+'/'+s.id+'/review',{headers:headers('outside-supervisor')})).status,403);
  await assert.rejects(transition(s.id,actor,'SUBMIT',2),e=>e.code==='INVALID_SCHEDULE_STATUS');
  const review=await fetch(base+'/'+s.id+'/review',{headers:headers('supervisor')});assert.equal(review.status,200);assert.equal((await review.json()).ready,true);
  await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[emptyShift]);
  await assert.rejects(transition(s.id,supervisor,'APPROVED',2),e=>e.code==='SOURCE_CHANGED');
  await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1',[emptyShift]);
  await assert.rejects(transition(s.id,actor,'APPROVED',2),e=>e.status===403);
  const employeeUrl=`http://127.0.0.1:${server.address().port}/api/employee-schedule?week_start=${day}`;
  const before=await fetch(employeeUrl,{headers:headers('employee')});assert.equal(before.status,200);assert.equal((await before.json()).result.assignments.length,0);
  const approvalBody={expected_version:2,request_id:h.id(++request)};
  const approved=await fetch(base+'/'+s.id+'/decision',{method:'POST',headers:headers('supervisor'),body:JSON.stringify({...approvalBody,decision:'APPROVED'})});assert.equal(approved.status,200);assert.equal((await approved.json()).schedule.status,'APPROVED');
  assert.equal((await transitionSchedule(s.id,supervisor,approvalBody,'APPROVED')).reused,true);
  await assert.rejects(transition(s.id,supervisor,'PUBLISH',2,{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()}),e=>e.status===403);
  await q('UPDATE staffing_requirements SET required_count=2 WHERE shift_id=$1',[emptyShift]);
  await assert.rejects(transition(s.id,actor,'PUBLISH',2,{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()}),e=>e.code==='SOURCE_CHANGED');
  await q('UPDATE staffing_requirements SET required_count=1 WHERE shift_id=$1',[emptyShift]);
  const publishBody={expected_version:2,request_id:h.id(++request),feedback_deadline_at:new Date(Date.now()+86400000).toISOString()};
  const published=await fetch(base+'/'+s.id+'/publish',{method:'POST',headers:headers('manager'),body:JSON.stringify(publishBody)});assert.equal(published.status,200);assert.equal((await published.json()).schedule.status,'PUBLISHED');
  assert.equal((await transitionSchedule(s.id,actor,publishBody,'PUBLISH')).reused,true);
  const after=await fetch(employeeUrl,{headers:headers('employee')});assert.equal(after.status,200);const visible=(await after.json()).result;assert.equal(visible.assignments.length,1);assert.equal(visible.assignments[0].version,2);
  assert.equal((await q("SELECT count(*)::int n FROM shift_assignments WHERE schedule_id=$1 AND status='ACTIVE'",[s.id])).rows[0].n,2);
  assert.equal((await q('SELECT sum(required_count)::int n FROM staffing_requirements WHERE branch_id=$1',[branch])).rows[0].n,3);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await q("SELECT has_function_privilege($1,'public.tv4_assert_schedule_checks_v2(uuid,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
