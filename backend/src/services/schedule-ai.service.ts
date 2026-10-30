import { createHash } from 'node:crypto';
import { inspectSchedule } from './schedule-review.service.js';
import { reviewAssignments, ScheduleError } from './scheduling.engine.js';
import { buildAISummary } from './schedule-ai.summary.js';
import { parseAIReport } from './schedule-ai.report.js';
import { schedulingAIAdvisor } from './schedule-ai.gemini.js';
import type { SchedulingAIAdvisor } from './scheduling-ai-advisor.js';
import type { AIEvaluation, AIReviewResponse, CheckedAIReport } from './schedule-ai.types.js';
import { MockScheduleAIRepository, SupabaseScheduleAIRepository, type ScheduleAIRepository } from '../repositories/schedule-ai.repository.js';
type Inspection=Awaited<ReturnType<typeof inspectSchedule>>;
interface Dependencies {advisor?:SchedulingAIAdvisor;inspect?:typeof inspectSchedule;repository?:ScheduleAIRepository}
const pending=new Set<string>();
const revision=(state:Inspection)=>createHash('sha256').update(JSON.stringify({input:state.validation.input_revision,status:state.saved.schedule.status,version:state.saved.schedule.version,assignments:state.assignments})).digest('hex');
function response(state:Inspection,advisor:SchedulingAIAdvisor):AIReviewResponse {
  return {status:advisor.configured?'NOT_EVALUATED':'NOT_CONFIGURED',message:advisor.configured?'Lịch chưa có đánh giá AI.':'AI chưa được cấu hình',schedule_id:state.saved.schedule.id,version:state.saved.schedule.version,configured:advisor.configured,model:advisor.model,evaluation:null,
    rule_check:{hard_constraints:state.validation.hard_constraints,codes:state.validation.issues.map(i=>i.code)}};
}
function blocked(state:Inspection) {
  return state.saved.schedule.status!=='DRAFT'||state.validation.hard_constraints!=='PASS'||!state.validation.input_current;
}
const storage=(state:Inspection)=>state.snapshot.source==='mock'?new MockScheduleAIRepository():new SupabaseScheduleAIRepository();
function isCurrent(evaluation:AIEvaluation,state:Inspection) {
  return evaluation.contract_version==='tv3-ai.v1'&&evaluation.schedule_id===state.saved.schedule.id&&evaluation.version===state.saved.schedule.version&&evaluation.input_revision===revision(state)&&!blocked(state);
}
export async function readAIEvaluation(id:string,branchId:string,expectedVersion:number,deps:Dependencies={}):Promise<AIReviewResponse> {
  const state=await(deps.inspect??inspectSchedule)(id,branchId,expectedVersion),advisor=deps.advisor??schedulingAIAdvisor(),base=response(state,advisor);
  if(!advisor.configured)return base;
  const record=await(deps.repository??storage(state)).latest(id);
  if(!record)return blocked(state)?{...base,status:'BLOCKED',message:'Rule Engine chưa xác nhận lịch DRAFT hiện hành hợp lệ. Cần xử lý trước khi gọi AI.'}:base;
  if(record.status==='FAILED')return {...base,status:'FAILED',message:'Lần đánh giá AI gần nhất thất bại. Lịch không thay đổi; có thể thử đánh giá lại sau khi kiểm tra cấu hình.'};
  const evaluation=record.evaluation;
  // Refuse old/unrecognised stored contracts before returning any report, including stale reports.
  try{
    if(!evaluation||evaluation.contract_version!=='tv3-ai.v1'||!Array.isArray(evaluation.employee_aliases)||!Array.isArray(evaluation.labels)||!Array.isArray(evaluation.missing_criteria)||evaluation.missing_criteria.some(v=>typeof v!=='string'))throw new Error('Unrecognised contract');
    parseAIReport({...evaluation.report,suggestions:evaluation.report.suggestions.map(({description,reason,candidate_assignments})=>({description,reason,candidate_assignments}))});
    if(evaluation.employee_aliases.some(a=>typeof a.code!=='string'||typeof a.employee_id!=='string')||evaluation.labels.some(a=>typeof a.code!=='string'||typeof a.label!=='string')||evaluation.report.suggestions.some(s=>!s.rule_check||!['PASS','REJECTED','NOT_APPLICABLE'].includes(s.rule_check.status)||typeof s.rule_check.message!=='string'))throw new Error('Unrecognised contract');
  }
  catch{return {...base,status:'FAILED',message:'Đánh giá đã lưu không đúng hợp đồng hiện tại. Cần đánh giá lại.'};}
  if(!isCurrent(evaluation,state)||record.model_name!==advisor.model)return {...base,status:'STALE',message:'Kết quả AI cũ đã hết hiệu lực do phiên bản, phân công, cấu hình hoặc dữ liệu đầu vào thay đổi.',evaluation};
  return {...base,status:'AVAILABLE',message:'Đánh giá tư vấn cho phiên bản hiện hành.',evaluation};
}
export async function evaluateSchedule(id:string,branchId:string,body:unknown,deps:Dependencies={}):Promise<AIReviewResponse> {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='expected_version'))throw new ScheduleError(400,'INVALID_AI_REQUEST','Chỉ gửi expected_version của lịch đã lưu.');
  const expectedVersion=(body as {expected_version:number}).expected_version,inspect=deps.inspect??inspectSchedule;
  const state=await inspect(id,branchId,expectedVersion),advisor=deps.advisor??schedulingAIAdvisor(),base=response(state,advisor);
  if(state.saved.schedule.status!=='DRAFT')throw new ScheduleError(409,'AI_DRAFT_REQUIRED','Chỉ đánh giá bản DRAFT đã lưu và hiện hành.');
  if(!advisor.configured)return base;
  if(blocked(state))return {...base,status:'BLOCKED',message:'Rule Engine chưa xác nhận các ràng buộc bắt buộc hoặc dữ liệu lịch đã thay đổi. AI chưa được gọi.'};
  const lock=`${branchId}/${id}`;
  if(pending.has(lock))throw new ScheduleError(409,'AI_REVIEW_IN_PROGRESS','Phiên bản này đang được đánh giá AI.');
  pending.add(lock);
  const repository=deps.repository??storage(state);
  try {
    // Verify storage is usable BEFORE an external call that may have a cost.
    await repository.latest(id);
    const prepared=buildAISummary(state),raw=await advisor.evaluate(prepared.summary),report=parseAIReport(raw);
    if((!state.validation.data_complete&&report.conclusion!=='INSUFFICIENT_DATA')||(report.conclusion==='SUITABLE'&&(!state.validation.coverage_complete||state.validation.coverage.some(r=>r.warning))))
      throw new ScheduleError(502,'AI_CONTRADICTS_RULES','Kết luận AI mâu thuẫn dữ liệu hoặc cảnh báo Rule Engine; không được coi là đánh giá hợp lệ.');
    const checked:CheckedAIReport={...report,suggestions:report.suggestions.map(s=>{
      if(s.candidate_assignments===null)return {...s,rule_check:{status:'NOT_APPLICABLE' as const,code:null,message:'Gợi ý bằng lời; chưa có phương án phân công để kiểm tra. Không được tự áp dụng.'}};
      try {
        const assignments=s.candidate_assignments.map(a=>{const decoded=prepared.decode(a);if(!decoded)throw new ScheduleError(422,'UNKNOWN_ALIAS','Đề xuất có mã nhân viên/ca/bộ phận ngoài tóm tắt.');return decoded;});
        reviewAssignments(prepared.input,assignments);
        return {...s,rule_check:{status:'PASS' as const,code:null,message:'Phương án qua ràng buộc bắt buộc trên dữ liệu hiện tại; chưa được áp dụng. Có thể vẫn thiếu người.'}};
      }catch(error){const issue=error instanceof ScheduleError?error:new ScheduleError(422,'INVALID_AI_PROPOSAL','Không thể kiểm tra đề xuất.');return {...s,rule_check:{status:'REJECTED' as const,code:issue.code,message:issue.message}};}
    })};
    // Recheck after provider latency and before persistence. Changes invalidate the response.
    const current=await inspect(id,branchId,expectedVersion);
    if(revision(current)!==revision(state)||blocked(current))throw new ScheduleError(409,'AI_REVIEW_STALE','Lịch hoặc dữ liệu đã thay đổi trong khi AI đánh giá. Kết quả không còn hiệu lực; hãy tải lại.');
    const evaluation:AIEvaluation={contract_version:'tv3-ai.v1',schedule_id:id,version:expectedVersion,input_revision:revision(state),created_at:new Date().toISOString(),report:checked,employee_aliases:prepared.aliases,labels:prepared.labels,missing_criteria:prepared.summary.missing_criteria};
    await repository.save(id,{status:'SUCCESS',evaluation,error_message:null,model_name:advisor.model});
    return {...base,status:'AVAILABLE',message:'AI đã đánh giá; đây là tư vấn, lịch chưa được thay đổi.',evaluation};
  }catch(error){
    if(error instanceof ScheduleError&&['AI_INVALID_RESPONSE','AI_PROVIDER_UNAVAILABLE','AI_CONTRADICTS_RULES'].includes(error.code)) {
      // Never retain provider raw output/errors/credentials. Only a controlled failure message is stored.
      const current=await inspect(id,branchId,expectedVersion);
      if(revision(current)!==revision(state))throw new ScheduleError(409,'AI_REVIEW_STALE','Dữ liệu đã thay đổi trong khi AI đánh giá.');
      await repository.save(id,{status:'FAILED',evaluation:null,error_message:error.message,model_name:advisor.model});
    }
    if(error instanceof ScheduleError)throw error;
    throw new ScheduleError(503,'AI_UNAVAILABLE','Không thể đánh giá AI. Không có thay đổi nào được áp dụng vào lịch.');
  }finally{pending.delete(lock);}
}
