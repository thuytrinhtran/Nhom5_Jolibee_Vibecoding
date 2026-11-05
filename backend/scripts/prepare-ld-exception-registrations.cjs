// Real-data, exceptional registration fixture for Lê Duẩn 09–15 Nov 2026.
// Default mode is read-only dry-run. --apply is intentionally gated and is
// included for a later separately confirmed import; this task never invokes it.
// --rollback removes only rows/headers listed in this fixture's exact receipt.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const SCOPE={project_ref:'wlbpprpiieonjrqglicv',branch_id:'11111111-1111-1111-1111-111111111111',period_id:'7f48f53e-d707-4a32-9f15-eb32aeb0095a',start:'2026-11-09',end:'2026-11-15'};
const BATCH='dc3d6a98-e209-4aa5-9b27-c8ca20261109';
const PLAN_FILE=path.join(ROOT,'docs','demo-datasets','ld-exceptions-20261109','plan.json');
const RECEIPT_FILE=path.join(ROOT,'docs','demo-datasets','ld-exceptions-20261109','receipt.json');
const stable=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const fail=code=>{throw Error(code)};
async function querySnapshot(q){
 const branch=(await q('SELECT id,name FROM branches WHERE id=$1',[SCOPE.branch_id]))[0];
 const period=(await q('SELECT id,branch_id,work_start_date::text,work_end_date::text,status,open_at,close_at FROM registration_periods WHERE id=$1',[SCOPE.period_id]))[0];
 const employees=await q('SELECT e.id,e.branch_id,e.department_id,e.full_name,e.skill_level,e.status,e.max_weekly_hours,u.role,u.is_active,u.branch_id user_branch FROM employees e JOIN users u ON u.id=e.user_id WHERE e.branch_id=$1 ORDER BY e.id',[SCOPE.branch_id]);
 const requirements=await q('SELECT id,branch_id,department_id,shift_id,work_date::text,required_count,required_skill_name,updated_at FROM staffing_requirements WHERE branch_id=$1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date,shift_id,department_id',[SCOPE.branch_id,SCOPE.start,SCOPE.end]);
 const headers=await q('SELECT period_id,employee_id,status,submitted_at,updated_at,sample_batch_id FROM registration_submissions WHERE period_id=$1 ORDER BY employee_id',[SCOPE.period_id]);
 const registrations=await q('SELECT id,period_id,employee_id,work_date::text,shift_id,status,submitted_at FROM shift_registrations WHERE period_id=$1 ORDER BY work_date,shift_id,employee_id',[SCOPE.period_id]);
 const shifts=await q('SELECT id,name,start_time::text,end_time::text,is_active,branch_id FROM shifts WHERE is_active AND (branch_id IS NULL OR branch_id=$1) ORDER BY start_time,id',[SCOPE.branch_id]);
 const departments=await q('SELECT id,name FROM departments ORDER BY id');
 const skills=await q('SELECT employee_id,skill_name FROM employee_skills ORDER BY employee_id,skill_name');
 const schedules=await q('SELECT id,period_id,status,version FROM schedules WHERE period_id=$1 ORDER BY id',[SCOPE.period_id]);
 const assignments=await q("SELECT a.id,a.schedule_id,a.employee_id,a.work_date::text,a.shift_id,a.department_id,a.status FROM shift_assignments a JOIN schedules s ON s.id=a.schedule_id WHERE s.period_id=$1 ORDER BY a.id",[SCOPE.period_id]);
 return {branch,period,employees,requirements,headers,registrations,shifts,departments,skills,schedules,assignments};
}
function configure(){
 const env=require('../node_modules/dotenv').parse(fs.readFileSync(path.join(ROOT,'backend','.env')));
 const url=(env.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
 if(url!==`https://${SCOPE.project_ref}.supabase.co`)fail('PROJECT_MISMATCH');
 process.env.NODE_ENV=env.NODE_ENV||'development';process.env.SUPABASE_URL=url;
 for(const key of ['TV3_WRITE_SCOPE_ENABLED','TV5_PG_CONNECTION_FILE','TV5_PG_CLIENT'])if(env[key])process.env[key]=env[key];
 const {acquireLocalProjectClient}=require('../dist/services/tv5-local-rpc.js');
 return acquireLocalProjectClient();
}
async function readSource(c){
 const q=async(sql,args=[]) => (await c.query(sql,args)).rows;
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await c.query("SET LOCAL statement_timeout='15s'; SET LOCAL timezone='UTC'; SET LOCAL jit=off");
  const {branch,period,employees,requirements,headers,registrations,shifts,departments,skills,schedules,assignments}=await querySnapshot(q);
  await c.query('COMMIT');
  if(!branch||!period||period.branch_id!==SCOPE.branch_id||period.work_start_date!==SCOPE.start||period.work_end_date!==SCOPE.end)fail('SCOPE_MISMATCH');
  return {branch,period,employees,requirements,headers,registrations,shifts,departments,skills,schedules,assignments};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
function mapInput(s){
 const employees=s.employees.filter(e=>e.status==='ACTIVE'&&e.role==='NV'&&e.is_active===true&&e.user_branch===SCOPE.branch_id&&e.skill_level!=='CREW_LEADER')
  .map(e=>({...e,is_active:true,role:'NV',skills:s.skills.filter(k=>k.employee_id===e.id).map(k=>k.skill_name)}));
 const validHeaders=new Set(s.headers.filter(h=>h.status==='VALID'&&h.submitted_at&&!h.sample_batch_id).map(h=>h.employee_id));
 return {rule_version:'tv3.rules.v2',period:{...s.period},employees,shifts:s.shifts,requirements:s.requirements,
  registrations:s.registrations.filter(r=>r.status==='VALID'&&r.submitted_at&&validHeaders.has(r.employee_id)).map(({id,period_id,...r})=>r),
  existing:s.assignments.filter(a=>a.status!=='REPLACED').map(({id,schedule_id,status,...r})=>r),new_employee_count_threshold:null};
}
function scenarios(s,input){
 const names=new Map(s.departments.map(d=>[d.id,d.name])),shiftNames=new Map(s.shifts.map(x=>[x.id,x.name]));
 const headers=new Set(s.headers.map(h=>h.employee_id)),eligible=input.employees.filter(e=>!headers.has(e.id));
 const depts=[...new Set(s.requirements.map(r=>r.department_id))];
 const cells=s.requirements.slice().sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.shift_id.localeCompare(b.shift_id)||a.department_id.localeCompare(b.department_id));
 const pool=eligible.slice().sort((a,b)=>a.id.localeCompare(b.id));
 if(pool.length<4)fail('NOT_ENOUGH_UNREGISTERED_EMPLOYEES');
 const rows=[],scenarioSlots={};
 const add=(employee,date,shift,caseId)=>{
  if(!employee) return false;
  const found=rows.find(r=>r.employee_id===employee.id&&r.work_date===date&&r.shift_id===shift);
  if(found){found.cases.push(caseId);return true;}
  rows.push({id:uuid(`${employee.id}/${date}/${shift}`),period_id:SCOPE.period_id,employee_id:employee.id,work_date:date,shift_id:shift,status:'VALID',cases:[caseId]});return true;
 };
 // 1: one valid candidate in a demand cell that needs at least three.
 const baseCellCount=c=>input.registrations.filter(r=>r.work_date===c.work_date&&r.shift_id===c.shift_id&&input.employees.find(e=>e.id===r.employee_id)?.department_id===c.department_id).length;
 const shortage=cells.find(c=>c.required_count>=3&&baseCellCount(c)<c.required_count);if(!shortage)fail('NO_QUANTITY_SHORTAGE_CELL');
 const de=depts;
 const empFor=(dep,level)=>pool.find(e=>e.department_id===dep&&(!level||e.skill_level===level));
 add(empFor(shortage.department_id,'REGULAR')||empFor(shortage.department_id,'CREW_TRAINING')||empFor(shortage.department_id),shortage.work_date,shortage.shift_id,'quantity-shortage');scenarioSlots['quantity-shortage']=[shortage];
 // 2: fill one 2+ position cell with NEW only, so count can be sufficient while
 // the engine reports missing experience. Put these rows on different employees.
 const expCell=cells.find(c=>c.required_count===2&&c.id!==shortage.id&&baseCellCount(c)===0&&pool.filter(e=>e.department_id===c.department_id&&e.skill_level==='NEW').length>=2);
 if(!expCell)fail('NO_EXPERIENCE_TEST_CELL');const newPeople=pool.filter(e=>e.department_id===expCell.department_id&&e.skill_level==='NEW');
 if(newPeople.length<expCell.required_count)fail('NOT_ENOUGH_NEW_EMPLOYEES_FOR_EXPERIENCE_CASE');
 newPeople.slice(0,expCell.required_count).forEach((e,i)=>add(e,expCell.work_date,expCell.shift_id,'experience-shortage'));scenarioSlots['experience-shortage']=[expCell];
 // 3: leave every position in this selected cell unregistered.
 const zeroCell=cells.find(c=>c.work_date==='2026-11-09'&&c.id!==shortage.id&&c.id!==expCell.id&&baseCellCount(c)===0)||cells.find(c=>c.id!==shortage.id&&c.id!==expCell.id&&baseCellCount(c)===0);
 if(!zeroCell)fail('NO_ZERO_REGISTRATION_CELL');scenarioSlots['zero-registration']=[zeroCell];
 // 4: cluster the few fixture registrations on 09–10 Nov and leave all later
 // dates and the other shifts short; this stays intentionally sparse.
 const concentrated=cells.find(c=>c.work_date==='2026-11-10'&&c.shift_id!==shortage.shift_id&&c.id!==zeroCell.id&&c.id!==expCell.id)||cells.find(c=>c.id!==shortage.id&&c.id!==zeroCell.id&&c.id!==expCell.id);
 const concentratedPeople=pool.filter(e=>e.department_id===concentrated.department_id&&e.id!==rows.find(r=>r.employee_id===e.id)?.employee_id).slice(0,Math.min(2,concentrated.required_count));
 if(!concentratedPeople.length)fail('NO_CONCENTRATION_CANDIDATES');concentratedPeople.forEach(e=>add(e,concentrated.work_date,concentrated.shift_id,'concentrated-shifts'));scenarioSlots['concentrated-shifts']=[concentrated];
 // 5: one eligible registered person outside the selected preview assignments,
 // sharing the same demand cell to surface as an add/replace candidate.
 const candidateCell=cells.find(c=>c.id!==shortage.id&&c.id!==expCell.id&&c.id!==zeroCell.id&&c.id!==concentrated.id&&c.required_count===1&&baseCellCount(c)===0&&pool.filter(e=>e.department_id===c.department_id).length>=2);
 if(!candidateCell)fail('NO_SINGLE_SLOT_CANDIDATE_CELL');
 const candidatePeople=pool.filter(e=>e.department_id===candidateCell.department_id&&e.id!==rows.find(r=>r.employee_id===e.id)?.employee_id).slice(0,2);
 if(candidatePeople.length<2)fail('NO_UNASSIGNED_CANDIDATE');candidatePeople.forEach(e=>add(e,candidateCell.work_date,candidateCell.shift_id,'extra-candidate'));scenarioSlots['extra-candidate']=[candidateCell];
 // 6: deliberately zero internal registrations in one cell; cross-branch support
 // is explicitly unsupported, so no out-of-branch person is synthesized.
 const supportCell=cells.find(c=>c.id!==zeroCell.id&&c.id!==shortage.id&&c.id!==expCell.id&&c.id!==concentrated.id&&c.id!==candidateCell.id)||zeroCell;
 scenarioSlots['cross-branch-support-required']=[supportCell];
 // 7: no INVALID registration rows are generated. Run a real cross-department
 // assertion plus isolated in-memory skill/overlap assertions, never persisted.
 scenarioSlots['rule-engine-negative-tests']=[shortage,expCell];
 return {rows,scenarioSlots,names,shiftNames};
}
function uuid(key){const h=crypto.createHash('sha256').update(`${BATCH}/${key}`).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
function verify(s,input,fixture){
 const {generateSchedule,assignmentIssue,reviewAssignments}=require('../dist/services/scheduling.engine.js');
 const allRows=fixture.rows.map(({cases,...r})=>r);const withFixture={...input,period:{...input.period,status:'CLOSED'},registrations:[...input.registrations,...allRows]};
 const result=generateSchedule(withFixture,{optimize:false});
 const need=fixture.scenarioSlots['quantity-shortage'][0];
 const employee=input.employees.find(e=>e.department_id!==need.department_id);
 const wrongDept=employee&&assignmentIssue(withFixture,employee,need,[]);
 if(wrongDept?.code!=='DEPARTMENT_MISMATCH')fail('RULE_ENGINE_DEPARTMENT_ASSERTION_FAILED');
 const registeredFixture=fixture.rows.find(r=>r.work_date===need.work_date&&r.shift_id===need.shift_id&&input.employees.find(e=>e.id===r.employee_id)?.department_id===need.department_id);
 const registeredPerson=input.employees.find(e=>e.id===registeredFixture?.employee_id);
 if(!registeredPerson)fail('NEGATIVE_TEST_EMPLOYEE_MISSING');
 const skillNeed={...need,required_skill_name:'__TEST_SKILL_NOT_IN_REAL_DEMAND__'};
 const skillResult=assignmentIssue(withFixture,registeredPerson,skillNeed,[])?.code||'NOT_REJECTED';
 if(skillResult!=='SKILL_MISMATCH')fail('RULE_ENGINE_SKILL_ASSERTION_FAILED');
 const originalShift=input.shifts.find(s=>s.id===need.shift_id);
 const overlapShift={...originalShift,id:'__TEST_OVERLAP_SHIFT__',start_time:'07:00:00',end_time:'09:00:00'};
 const overlapInput={...withFixture,shifts:[...withFixture.shifts,overlapShift]};
 const overlapResult=assignmentIssue(overlapInput,registeredPerson,need,[{employee_id:registeredPerson.id,work_date:need.work_date,shift_id:overlapShift.id,department_id:need.department_id}])?.code||'NOT_REJECTED';
 if(overlapResult!=='SHIFT_OVERLAP')fail('RULE_ENGINE_OVERLAP_ASSERTION_FAILED');
 const coverage=result.coverage;
 const byCase=Object.entries(fixture.scenarioSlots).map(([caseId,items])=>({caseId,cells:items.map(n=>{const r=coverage.find(x=>x.id===n.id);const registered=new Set([...input.registrations,...allRows].filter(x=>x.work_date===n.work_date&&x.shift_id===n.shift_id&&input.employees.find(e=>e.id===x.employee_id)?.department_id===n.department_id).map(x=>x.employee_id)).size;return{date:n.work_date,shift:fixture.shiftNames.get(n.shift_id),department:fixture.names.get(n.department_id),required:n.required_count,registered,fixture_added:fixture.rows.filter(x=>x.work_date===n.work_date&&x.shift_id===n.shift_id&&input.employees.find(e=>e.id===x.employee_id)?.department_id===n.department_id).length,missing:r?.missing_count,missingExperienced:r?.missing_experienced_count};}),expected:caseId==='cross-branch-support-required'?'Không có ứng viên nội bộ; báo thiếu, chi viện liên chi nhánh chưa hỗ trợ.':caseId==='rule-engine-negative-tests'?'Từ chối department/skill/overlap không hợp lệ; không tạo đăng ký INVALID.':caseId==='extra-candidate'?'Có 2 đăng ký hợp lệ cho 1 vị trí; Rule Engine xếp tối đa 1, còn ít nhất 1 ứng viên chưa xếp.':caseId==='zero-registration'?'0 đăng ký hợp lệ; thiếu toàn bộ nhu cầu ô đã chọn.':caseId==='experience-shortage'?'Đủ số đăng ký ở ô kiểm thử, thiếu cấp REGULAR/CREW_TRAINING.':caseId==='concentrated-shifts'?'Đăng ký gom ở ô này; các ca khác để thiếu.':'Thiếu số người so với nhu cầu.'}));
 const exp=byCase.find(x=>x.caseId==='experience-shortage').cells[0];if(exp.registered!==exp.required||exp.missingExperienced<1)fail('EXPERIENCE_CASE_EXPECTATION_FAILED');
 const zero=byCase.find(x=>x.caseId==='zero-registration').cells[0];if(zero.registered!==0||zero.missing!==zero.required)fail('ZERO_REGISTRATION_CASE_EXPECTATION_FAILED');
 const extra=byCase.find(x=>x.caseId==='extra-candidate').cells[0];if(extra.fixture_added<2||extra.required!==1)fail('EXTRA_CANDIDATE_CASE_EXPECTATION_FAILED');
 const extraNeed=fixture.scenarioSlots['extra-candidate'][0];
 const extraRows=fixture.rows.filter(x=>x.work_date===extraNeed.work_date&&x.shift_id===extraNeed.shift_id&&input.employees.find(e=>e.id===x.employee_id)?.department_id===extraNeed.department_id);
 const selected=result.assignments.filter(x=>x.work_date===extraNeed.work_date&&x.shift_id===extraNeed.shift_id&&x.department_id===extraNeed.department_id);
 const unassigned=extraRows.filter(x=>!selected.some(a=>a.employee_id===x.employee_id));
 if(selected.length!==1||unassigned.length!==1)fail('UNASSIGNED_WEB_CANDIDATE_EXPECTATION_FAILED');
 const waitingEmployee=input.employees.find(e=>e.id===unassigned[0].employee_id);
 const managerAddition=reviewAssignments(withFixture,[{employee_id:waitingEmployee.id,work_date:extraNeed.work_date,shift_id:extraNeed.shift_id,department_id:extraNeed.department_id}]);
 const managerReplacement=reviewAssignments(withFixture,selected.map(a=>({employee_id:waitingEmployee.id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id})));
 if(managerAddition.assigned_count!==1||managerReplacement.assigned_count!==1)fail('WEB_CANDIDATE_CONFIRMATION_EXPECTATION_FAILED');
 const candidateUiSteps=['Trong bản preview ban đầu có một phân công và một ứng viên hợp lệ chưa xếp.','Thử thêm: bỏ phân công ở ô này trong editor, mở Tìm ứng viên và xác nhận ứng viên đang chờ; Rule Engine phải chấp nhận.','Thử thay: giữ phân công và dùng Tìm người thay, chọn cùng ứng viên đang chờ rồi xác nhận; Rule Engine phải chấp nhận.'];
 const candidateCase=byCase.find(x=>x.caseId==='extra-candidate');candidateCase.unassigned_valid_candidates=unassigned.length;candidateCase.ui_steps=candidateUiSteps;
 const coverageReport=coverage.map(c=>({date:c.work_date,shift:fixture.shiftNames.get(c.shift_id),department:fixture.names.get(c.department_id),required:c.required_count,registered:new Set([...input.registrations,...allRows].filter(x=>x.work_date===c.work_date&&x.shift_id===c.shift_id&&input.employees.find(e=>e.id===x.employee_id)?.department_id===c.department_id).map(x=>x.employee_id)).size,assigned:c.assigned_count,missing:c.missing_count,experienced_missing:c.missing_experienced_count,fixture_added:fixture.rows.filter(x=>x.work_date===c.work_date&&x.shift_id===c.shift_id&&input.employees.find(e=>e.id===x.employee_id)?.department_id===c.department_id).length}));
 return {result,byCase,coverageReport,skillResult,overlapResult,departmentResult:wrongDept.code,webCandidateChecks:{unassigned:unassigned.length,addition_accepted:managerAddition.assigned_count===1,replacement_accepted:managerReplacement.assigned_count===1}};
}
function validateInsertRows(input,rows){
 const {interval}=require('../dist/services/scheduling.engine.js');const keys=new Set();
 for(const r of rows){const e=input.employees.find(x=>x.id===r.employee_id),shift=input.shifts.find(x=>x.id===r.shift_id);if(!e||e.status!=='ACTIVE'||e.role!=='NV'||!e.is_active||!shift?.is_active||shift.branch_id&&shift.branch_id!==SCOPE.branch_id||r.work_date<SCOPE.start||r.work_date>SCOPE.end)fail('INVALID_FIXTURE_REGISTRATION');const need=input.requirements.find(x=>x.work_date===r.work_date&&x.shift_id===r.shift_id&&x.department_id===e.department_id);if(!need)fail('REGISTRATION_WITHOUT_DEMAND_DEPARTMENT');const key=`${r.employee_id}/${r.work_date}/${r.shift_id}`;if(keys.has(key))fail('DUPLICATE_FIXTURE_REGISTRATION');keys.add(key);}
 for(let i=0;i<rows.length;i++){const a=rows[i],sa=input.shifts.find(x=>x.id===a.shift_id),[as,ae]=interval(a.work_date,sa);for(let j=i+1;j<rows.length;j++){const b=rows[j];if(a.employee_id!==b.employee_id)continue;const [bs,be]=interval(b.work_date,input.shifts.find(x=>x.id===b.shift_id));if(as<be&&bs<ae)fail('FIXTURE_REGISTRATION_OVERLAP');}}
}
function buildPlan(s){
 if(s.schedules.length||s.assignments.length)fail('TARGET_SCHEDULE_EXISTS');
 if(s.headers.some(h=>!h.sample_batch_id&&h.status==='VALID'&&h.submitted_at)){} // Existing valid rows are immutable baseline.
 const input=mapInput(s);const fixture=scenarios(s,input);validateInsertRows(input,fixture.rows);const check=verify(s,input,fixture);
 const selectedEmployeeIds=[...new Set(fixture.rows.map(r=>r.employee_id))];
 if(selectedEmployeeIds.some(id=>s.headers.some(h=>h.employee_id===id)))fail('EMPLOYEE_ALREADY_HAS_SUBMISSION');
 const plan={format:'ld-exception-registrations.v1',...SCOPE,batch_id:BATCH,created_at:new Date().toISOString(),baseline_sha256:hash(s),
  period_status:s.period.status,rule_engine_preview_status:s.period.status==='CLOSED'?'AVAILABLE':'BLOCKED_UNTIL_PERIOD_CLOSED',
  intent:'EXCEPTIONAL_SPARSE_DATA_ONLY; NO_FULL_DEMAND_FILL; NO_INVALID_REGISTRATIONS; NO_EXISTING_ROW_MUTATION',
  employees:input.employees.filter(e=>selectedEmployeeIds.includes(e.id)).map(({id,department_id,skill_level,status})=>({id,department_id,skill_level,status})),
  new_headers:selectedEmployeeIds.map(employee_id=>({period_id:SCOPE.period_id,employee_id,status:'VALID',errors:[],submitted_at:'DB_TRANSACTION_TIME',sample_batch_id:null})),
  new_rows:fixture.rows.map(({cases,...r})=>({...r,cases})),
  scenarios:check.byCase,preview_coverage:check.coverageReport,summary:{new_headers:selectedEmployeeIds.length,new_valid_registrations:fixture.rows.length,required_count:check.result.required_count,assigned_count:check.result.assigned_count,shortage_cells:check.result.shortages.length,experience_shortage_cells:check.result.composition_shortages.length,web_candidate_checks:check.webCandidateChecks,department_negative_assertion:check.departmentResult,skill_negative_assertion:check.skillResult,overlap_negative_assertion:check.overlapResult,negative_tests:'Skill and overlap are isolated in-memory Rule Engine tests; real needs have no required_skill_name and actual shifts do not overlap.',period_status:s.period.status,preview_status:planStatus(s.period.status)},
  rollback:{mode:'DELETE_EXACT_INSERTED_IMAGES_ONLY',guard:'requires exact current header/row after-images and plan hash; never deletes unrelated rows'},
 };
 plan.plan_sha256=hash(plan);return{plan,input,fixture,check};
}
function planStatus(status){return status==='CLOSED'?'AVAILABLE':'BLOCKED_UNTIL_PERIOD_CLOSED';}
async function apply(plan){
 const c=await configure();try{
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL timezone='UTC'");
  await c.query('LOCK TABLE registration_periods,employees,users,staffing_requirements,registration_submissions,shift_registrations,schedules,shift_assignments IN SHARE ROW EXCLUSIVE MODE NOWAIT');
  const {plan_sha256,...unsigned}=plan;if(plan_sha256!==hash(unsigned))fail('PLAN_DIGEST_MISMATCH');
  if(fs.existsSync(RECEIPT_FILE)){
   const prior=JSON.parse(fs.readFileSync(RECEIPT_FILE));if(prior.plan_sha256!==plan.plan_sha256)fail('EXISTING_FIXTURE_RECEIPT_CONFLICT');
   for(const r of prior.rows){const current=(await c.query('SELECT * FROM shift_registrations WHERE id=$1',[r.id])).rows[0];if(!current||hash(current)!==hash(r))fail('EXISTING_FIXTURE_AFTER_IMAGE_CHANGED');}
   for(const h of prior.headers){const current=(await c.query('SELECT * FROM registration_submissions WHERE period_id=$1 AND employee_id=$2',[h.period_id,h.employee_id])).rows[0];if(!current||hash(current)!==hash(h))fail('EXISTING_FIXTURE_AFTER_IMAGE_CHANGED');}
   await c.query('COMMIT');console.log(JSON.stringify({applied:true,reused:true,headers:prior.headers.length,rows:prior.rows.length}));return;
  }
  if(await baselineHashInTx(c)!==plan.baseline_sha256)fail('BASELINE_CHANGED');
  if((await c.query('SELECT 1 FROM schedules WHERE period_id=$1 LIMIT 1',[SCOPE.period_id])).rowCount)fail('TARGET_SCHEDULE_EXISTS');
  const now=await c.query('SELECT clock_timestamp() t');
  if(plan.period_status!=='OPEN'||new Date(now.rows[0].t)>=new Date('2026-11-08T05:00:00.000Z'))fail('REGISTRATION_WINDOW_CLOSED_REPREPARE');
  for(const h of plan.new_headers){if((await c.query('SELECT 1 FROM registration_submissions WHERE period_id=$1 AND employee_id=$2',[h.period_id,h.employee_id])).rowCount)fail('EMPLOYEE_ALREADY_HAS_SUBMISSION');}
  for(const r of plan.new_rows){if((await c.query('SELECT 1 FROM shift_registrations WHERE id=$1 OR (period_id=$2 AND employee_id=$3 AND work_date=$4 AND shift_id=$5)',[r.id,r.period_id,r.employee_id,r.work_date,r.shift_id])).rowCount)fail('REGISTRATION_COLLISION');}
  const headerImages=[],rowImages=[];
  for(const h of plan.new_headers){const row=(await c.query("INSERT INTO registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at,sample_batch_id) VALUES($1,$2,'VALID','[]'::jsonb,clock_timestamp(),clock_timestamp(),NULL) RETURNING *",[h.period_id,h.employee_id])).rows[0];headerImages.push(row);}
  for(const r of plan.new_rows){const row=(await c.query("INSERT INTO shift_registrations(id,period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at) VALUES($1,$2,$3,$4,$5,'VALID',clock_timestamp(),clock_timestamp()) RETURNING *",[r.id,r.period_id,r.employee_id,r.work_date,r.shift_id])).rows[0];rowImages.push(row);}
  const receipt={format:'ld-exception-receipt.v1',plan_sha256:plan.plan_sha256,batch_id:BATCH,baseline_sha256:plan.baseline_sha256,headers:headerImages,rows:rowImages};
  await c.query('COMMIT');fs.mkdirSync(path.dirname(RECEIPT_FILE),{recursive:true});fs.writeFileSync(RECEIPT_FILE,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({applied:true,headers:headerImages.length,rows:rowImages.length,receipt:RECEIPT_FILE}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
}
async function baselineHashInTx(c){const q=async(sql,args=[]) => (await c.query(sql,args)).rows;return hash(await querySnapshot(q));}
async function rollback(){
 if(!fs.existsSync(RECEIPT_FILE))fail('ROLLBACK_RECEIPT_MISSING');const receipt=JSON.parse(fs.readFileSync(RECEIPT_FILE));const c=await configure();try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");await c.query('LOCK TABLE registration_periods,registration_submissions,shift_registrations,schedules,shift_assignments IN SHARE ROW EXCLUSIVE MODE NOWAIT');if((await c.query('SELECT 1 FROM schedules WHERE period_id=$1 LIMIT 1',[SCOPE.period_id])).rowCount)fail('ROLLBACK_BLOCKED_SCHEDULE_EXISTS');
  for(const r of receipt.rows){const current=(await c.query('SELECT * FROM shift_registrations WHERE id=$1',[r.id])).rows[0];if(!current||hash(current)!==hash(r))fail('ROLLBACK_ROW_CHANGED');}
  for(const h of receipt.headers){const current=(await c.query('SELECT * FROM registration_submissions WHERE period_id=$1 AND employee_id=$2',[h.period_id,h.employee_id])).rows[0];if(!current||hash(current)!==hash(h))fail('ROLLBACK_HEADER_CHANGED');}
  await c.query('DELETE FROM shift_registrations WHERE id=ANY($1::uuid[])',[receipt.rows.map(r=>r.id)]);for(const h of receipt.headers)await c.query('DELETE FROM registration_submissions WHERE period_id=$1 AND employee_id=$2',[h.period_id,h.employee_id]);await c.query('COMMIT');fs.renameSync(RECEIPT_FILE,RECEIPT_FILE+'.rolled-back');console.log(JSON.stringify({rolled_back:true,headers:receipt.headers.length,rows:receipt.rows.length}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
}
async function main(){
 const c=await configure();let source;try{source=await readSource(c);}finally{await c.end();}
 const built=buildPlan(source);const {plan,check,fixture}=built;
 fs.mkdirSync(path.dirname(PLAN_FILE),{recursive:true});fs.writeFileSync(PLAN_FILE,JSON.stringify(plan,null,2)+'\n');
 const current=await configure();let currentSnapshot;try{currentSnapshot=await readSource(current);}finally{await current.end();}const currentHash=hash(currentSnapshot);
 const caseSummary=plan.scenarios.map(x=>({case:x.caseId,slots:x.cells.map(s=>`${s.date} ${s.shift} / ${s.department}: need ${s.required}, regs ${s.registered}, missing ${s.missing}`),expected:x.expected}));
 console.log(JSON.stringify({mode:'DRY_RUN_READ_ONLY',scope:{branch:source.branch.name,period:source.period.id,dates:`${SCOPE.start}..${SCOPE.end}`,period_status:source.period.status},source:{eligible_employees:built.input.employees.length,requirements:source.requirements.length,existing_headers:source.headers.length,existing_valid_submitted:source.headers.filter(h=>h.status==='VALID'&&h.submitted_at).length,existing_valid_rows:source.registrations.filter(r=>r.status==='VALID'&&r.submitted_at).length,published_or_draft_schedules:source.schedules.length},fixture:{new_headers:plan.new_headers.length,new_valid_rows:fixture.rows.length,required:check.result.required_count,assigned:check.result.assigned_count,shortage_cells:check.result.shortages.length,experience_shortage_cells:check.result.composition_shortages.length,scenarioSummary:caseSummary,web_candidate_checks:check.webCandidateChecks,negative_assertions:{department:check.departmentResult,skill:check.skillResult,overlap:check.overlapResult},baseline_unchanged:currentHash===plan.baseline_sha256,plan_file:path.relative(ROOT,PLAN_FILE),writes_to_supabase:0,preview_blocked_until_closed:source.period.status!=='CLOSED'},coverage:plan.preview_coverage}));
}
const mode=process.argv.slice(2);
if(mode.includes('--apply')){const p=JSON.parse(fs.readFileSync(PLAN_FILE));if(process.env.CONFIRM_LD_EXCEPTION_IMPORT!==p.plan_sha256)fail('EXPLICIT_PLAN_DIGEST_CONFIRMATION_REQUIRED');apply(p).catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'FIXTURE_APPLY_FAILED');process.exitCode=1;});}
else if(mode.includes('--rollback'))rollback().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'FIXTURE_ROLLBACK_FAILED');process.exitCode=1;});
else main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message||'')?e.message:(e.code||e.name||'FIXTURE_DRY_RUN_FAILED'));process.exitCode=1;});
