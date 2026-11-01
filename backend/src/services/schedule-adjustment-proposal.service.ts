import { createHash } from 'node:crypto';
import { inspectPreview } from './schedule-preview.service.js';
import { issueProposalReceipt, readAdjustmentReceipt, type AdjustmentReceipt } from './schedule-adjustment-receipt.js';
import { assignmentIssue, generateSchedule, reviewAssignments, ScheduleError, type Assignment, type SchedulingInput } from './scheduling.engine.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';

type Result=ReturnType<typeof reviewAssignments>;
const plain=({employee_id,work_date,shift_id,department_id}:Assignment):Assignment=>({employee_id,work_date,shift_id,department_id});
const assignmentKey=(a:Assignment)=>JSON.stringify([a.employee_id,a.work_date,a.shift_id,a.department_id]);
const hours=(result:Result,id:string)=>result.employee_statistics.find(e=>e.employee_id===id)?.total_weekly_hours??0;

export function proposeFromIntent(input:SchedulingInput,original:Assignment[],analysis:AdjustmentReceipt) {
 // Every candidate is checked against the ORIGINAL source; preferences never relax hard rules.
 const baseline=reviewAssignments(input,original);
 if(original.length>1000||input.employees.length>200||input.requirements.length>500)throw new ScheduleError(422,'ADJUSTMENT_TOO_LARGE','Phương án quá lớn cho bước đề xuất tương tác; chưa thay đổi lịch.');
 const ids=analysis.employees.map(e=>e.employee_id),resolve=(code:string|null)=>code===null?null:analysis.employees.find(e=>e.code===code)?.employee_id;
 const metric=(result:Result)=>{
  const values:{key:string;value:number;target:string;kind:string}[]=[];
  for(const objective of analysis.intent.objectives){
   if(objective==='REDUCE_LOAD'||objective==='INCREASE_LOAD')for(const id of ids)values.push({key:objective+':'+id,kind:objective,target:id,value:(objective==='REDUCE_LOAD'?1:-1)*hours(result,id)});
   if(objective==='BALANCE_HOURS'){
    // Compare hours only among registered, eligible staff within the same department.
    let spread=0;const departments=[...new Set(input.employees.map(e=>e.department_id))];
    for(const department of departments){const eligible=result.employee_statistics.filter(s=>input.employees.some(e=>e.id===s.employee_id&&e.department_id===department)&&input.registrations.some(r=>r.employee_id===s.employee_id&&r.status==='VALID'));
     const mean=eligible.reduce((sum,s)=>sum+s.total_weekly_hours,0)/Math.max(1,eligible.length);
     spread+=eligible.reduce((sum,s)=>sum+(s.total_weekly_hours-mean)**2,0)/Math.max(1,eligible.length);}
    values.push({key:objective,kind:objective,target:'ALL',value:spread});
   }
  }
  analysis.intent.limits.forEach((limit,index)=>{const id=resolve(limit.employee_code);let value=0;
   if(limit.kind==='MAX_WEEKLY_HOURS')value=Math.max(0,hours(result,id!)-limit.value!);
   if(limit.kind==='AVOID_DATE')value=result.assignments.filter(a=>a.work_date===limit.date&&(!id||a.employee_id===id)).length;
   if(limit.kind==='PREFER_DATE')value=result.assignments.some(a=>a.work_date===limit.date&&(!id||a.employee_id===id))?0:1;
   values.push({key:'LIMIT:'+index,kind:limit.kind,target:limit.employee_code??'ALL',value});
  });return values;
 };
 const initialMetrics=metric(baseline),score=(result:Result)=>metric(result).reduce((sum,m,i)=>sum+m.value/Math.max(1,Math.abs(initialMetrics[i].value)),0);
 const warnings=(result:Result)=>result.coverage.filter(r=>r.warning).length;
 const blockers=new Map<string,{code:string;message:string;attempts:number}>();
 const blocked=(issue:{code:string;message:string})=>{const old=blockers.get(issue.code);blockers.set(issue.code,{...issue,attempts:(old?.attempts??0)+1});};
 let best=baseline,bestScore=score(baseline),attempts=0,bounded=false;
 const deadline=performance.now()+750,maxAttempts=400;
 const remaining=()=>{const ok=attempts<maxAttempts&&performance.now()<deadline;if(!ok)bounded=true;return ok;};
 const consider=(assignments:Assignment[])=>{
  if(!remaining())return false;attempts++;let candidate:Result;
  try{candidate=reviewAssignments(input,assignments.map(plain));}catch(error){if(error instanceof ScheduleError&&error.status===422){blocked(error);return false;}throw error;}
  if(baseline.coverage.some(r=>(candidate.coverage.find(c=>c.id===r.id)?.assigned_count??0)<r.assigned_count))return false;
  if(baseline.coverage.some(r=>(candidate.coverage.find(c=>c.id===r.id)?.experienced_count??0)<r.experienced_count))return false;
  const value=score(candidate);
  // Coverage first, then avoid increasing composition warnings, then soft preferences.
  const improves=candidate.assigned_count>best.assigned_count||candidate.assigned_count===best.assigned_count&&(warnings(candidate)<warnings(best)||warnings(candidate)===warnings(best)&&value<bestScore-1e-8);
  if(improves){best=candidate;bestScore=value;return true;}return false;
 };
 const complete=(seed:Assignment[],working:SchedulingInput=input)=>{
  const requirements=input.requirements.map(r=>({...r,required_count:Math.max(0,r.required_count-seed.filter(a=>a.work_date===r.work_date&&a.shift_id===r.shift_id&&a.department_id===r.department_id).length)})).filter(r=>r.required_count>0);
  if(!requirements.length)return seed;
  const generated=generateSchedule({...working,requirements:input.requirements,existing:[...input.existing,...seed]});return [...seed,...generated.assignments.map(plain)];
 };
 consider(complete(baseline.assignments.map(plain)));
 // Regeneration uses stricter candidate pools/caps only; original declared demand is unchanged.
 const restricted=structuredClone(input);
 restricted.registrations=restricted.registrations.filter(r=>!analysis.intent.limits.some(l=>l.kind==='AVOID_DATE'&&r.work_date===l.date&&(!resolve(l.employee_code)||r.employee_id===resolve(l.employee_code)))&&!(analysis.intent.objectives.includes('REDUCE_LOAD')&&ids.includes(r.employee_id)));
 for(const limit of analysis.intent.limits)if(limit.kind==='MAX_WEEKLY_HOURS'){const e=restricted.employees.find(e=>e.id===resolve(limit.employee_code));if(e)e.max_weekly_hours=Math.min(e.max_weekly_hours??Infinity,limit.value!);}
 consider(generateSchedule(restricted).assignments);
 // Bounded substitutions and swaps reuse the existing review; no alternative rule engine.
 for(let pass=0;pass<3&&remaining();pass++){
  let changed=false;
  for(let index=0;index<best.assignments.length&&remaining();index++){
   const slot=plain(best.assignments[index]),need=input.requirements.find(r=>r.work_date===slot.work_date&&r.shift_id===slot.shift_id&&r.department_id===slot.department_id)!;
   const others=best.assignments.filter((_,i)=>i!==index).map(plain);
   const employees=[...input.employees].sort((a,b)=>Number(ids.includes(b.id)&&analysis.intent.objectives.includes('INCREASE_LOAD'))-Number(ids.includes(a.id)&&analysis.intent.objectives.includes('INCREASE_LOAD'))||a.id.localeCompare(b.id));
   for(const employee of employees){if(!remaining())break;if(employee.id===slot.employee_id)continue;const issue=assignmentIssue(input,employee,need,[...input.existing,...others]);if(issue){blocked(issue);continue;}
    if(consider(complete([...others,{...slot,employee_id:employee.id}]))){changed=true;break;}}
  }
  if(!changed)break;
 }
 const swapBase=best.assignments.map(plain);
 for(let i=0;i<swapBase.length&&remaining();i++)for(let j=i+1;j<swapBase.length&&remaining();j++){
  if(best.assignments[i].employee_id===best.assignments[j].employee_id)continue;
  const candidate=best.assignments.map(plain);[candidate[i].employee_id,candidate[j].employee_id]=[candidate[j].employee_id,candidate[i].employee_id];consider(candidate);
 }
 best=reviewAssignments(input,best.assignments.map(plain));
 const finalMetrics=metric(best),satisfaction=finalMetrics.map((m,i)=>{
  const before=initialMetrics[i].value,after=m.value,isLimit=m.key.startsWith('LIMIT:');
  const satisfied=isLimit?after===0:after<before-1e-8||m.kind==='BALANCE_HOURS'&&after===0;
  return {criterion:m.kind,target:m.target,before,after,status:satisfied?'SATISFIED':after<before-1e-8?'PARTIAL':'UNMET',reason:satisfied?'Nguyện vọng được cải thiện/đáp ứng trong phương án đã kiểm tra.':bounded?'Chưa tìm được cải thiện trong giới hạn tìm kiếm; giữ coverage và quy tắc bắt buộc.':'Không tìm thấy thay đổi phù hợp mà vẫn giữ coverage và các quy tắc bắt buộc; không kết luận tối ưu toàn cục.'};
 });
 if(analysis.intent.objectives.includes('PREFER_AVAILABILITY')&&!analysis.intent.limits.some(l=>l.kind==='PREFER_DATE'||l.kind==='AVOID_DATE'))satisfaction.push({criterion:'PREFER_AVAILABILITY',target:'ALL',before:0,after:0,status:'UNMET',reason:'Cần chỉ rõ ngày ưu tiên hoặc tránh; không tự suy đoán.'});
 const originalKeys=new Set(baseline.assignments.map(assignmentKey)),newKeys=new Set(best.assignments.map(assignmentKey));
 return {result:best,changes:{added:best.assignments.filter(a=>!originalKeys.has(assignmentKey(a))).map(plain),removed:baseline.assignments.filter(a=>!newKeys.has(assignmentKey(a))).map(plain)},satisfaction,
  blocking_reasons:[...blockers.values()].sort((a,b)=>a.code.localeCompare(b.code)),coverage_preserved:true,unchanged:[...originalKeys].every(k=>newKeys.has(k))&&originalKeys.size===newKeys.size,
  search:{attempts,bounded,optimality_guaranteed:false},limitations:['Tìm kiếm có giới hạn, không bảo đảm tối ưu toàn cục.','Coverage của từng nhu cầu không thấp hơn lịch gốc; nguyện vọng không ghi đè ràng buộc.','Đề xuất chỉ trong bộ nhớ, chưa thay thế hoặc lưu lịch hiện tại.']};
}

export async function proposeAdjustment(periodId:string,branchId:string,actorId:string,body:Record<string,unknown>,repository?:RegistrationSummaryRepository) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['period_id','input_revision','assignments','schedule_id','expected_version','analysis_token'].includes(k))||typeof body.analysis_token!=='string'||typeof body.input_revision!=='string'||!Array.isArray(body.assignments))throw new ScheduleError(400,'INVALID_ADJUSTMENT_PROPOSAL','Cần phương án gốc và kết quả phân tích được backend xác nhận.');
 const {analysis_token,...plan}=body,state=await inspectPreview(periodId,branchId,plan,repository);
 const planRevision=createHash('sha256').update(JSON.stringify({revision:state.revision,target:state.target,assignments:body.assignments})).digest('hex');
 const analysis=readAdjustmentReceipt(analysis_token,actorId,branchId,periodId,planRevision);
 const proposal=proposeFromIntent(state.input,state.result.assignments,analysis);
 await inspectPreview(periodId,branchId,plan,repository);
 const proposalHash=createHash('sha256').update(JSON.stringify(proposal.result.assignments.map(plain))).digest('hex');
 const proposalToken=issueProposalReceipt({actor:actorId,branch:branchId,period:periodId,revision:planRevision,proposal:proposalHash,expires:analysis.expires});
 return {proposal_token:proposalToken,expires_at:new Date(analysis.expires).toISOString(),scope:'adjustment-proposal' as const,persisted:false as const,applied:false as const,input_revision:state.revision,base_plan_revision:planRevision,...proposal};
}
