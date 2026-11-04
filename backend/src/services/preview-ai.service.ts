import { createHash } from 'node:crypto';
import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';
import { inspectPreview } from './schedule-preview.service.js';
import { summarizeRegistrations } from './registration-summary.service.js';
import { buildAISummary } from './schedule-ai.summary.js';
import { parseAIReport } from './schedule-ai.report.js';
import { assertAIConclusion } from './schedule-ai.service.js';
import { schedulingAIAdvisor } from './schedule-ai.gemini.js';
import type { SchedulingAIAdvisor } from './scheduling-ai-advisor.js';
import type { PreviewAIReviewResponse } from './schedule-ai.types.js';
import { ScheduleError } from './scheduling.engine.js';

const pending=new Set<string>();
export function previewAIConfiguration(advisor:SchedulingAIAdvisor=schedulingAIAdvisor()) {
  return {configured:advisor.configured,model:advisor.model,message:advisor.configured?`Gemini (${advisor.model}) sẽ tự đánh giá phương án đã kiểm tra.`:'AI chưa được cấu hình. Backend cần TV3_AI_EXTERNAL_ENABLED=true, TV3_AI_PROVIDER=gemini, TV3_AI_MODEL hợp lệ (hoặc TV3_AI_DEVELOPMENT_MODEL trong development) và GEMINI_API_KEY. Chưa có yêu cầu nào được gửi tới Gemini.'};
}
export async function evaluatePreview(periodId:string,branchId:string,actorId:string,body:Record<string,unknown>,deps:{repository?:RegistrationSummaryRepository;advisor?:SchedulingAIAdvisor}={}):Promise<PreviewAIReviewResponse> {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['period_id','input_revision','assignments','schedule_id','expected_version'].includes(k))||typeof body.input_revision!=='string'||!Array.isArray(body.assignments))
    throw new ScheduleError(400,'INVALID_AI_PREVIEW','Cần phương án phân công và mã dữ liệu nguồn đã kiểm tra.');
  const repository=deps.repository??registrationSummaryRepository();
  const state=await inspectPreview(periodId,branchId,body,repository);
  const planRevision=createHash('sha256').update(JSON.stringify({revision:state.revision,target:state.target,assignments:body.assignments})).digest('hex');
  const advisor=deps.advisor??schedulingAIAdvisor(),base={scope:'preview' as const,persisted:false as const,input_revision:state.revision,plan_revision:planRevision,configured:advisor.configured,model:advisor.model};
  if(!advisor.configured)return {...base,status:'NOT_CONFIGURED',message:'AI chưa được cấu hình',evaluation:null};
  const lock=`${actorId}/${branchId}/${periodId}`;
  if(pending.has(lock))throw new ScheduleError(409,'AI_REVIEW_IN_PROGRESS','Phương án này đang được đánh giá AI.');
  pending.add(lock);
  try{
    const summary=summarizeRegistrations(state.snapshot);
    const dataComplete=summary.rows.every(r=>r.status!=='UNKNOWN')&&!summary.warnings.some(w=>['INVALID_REGISTRATION','INVALID_REQUIREMENT','MISSING_REQUIREMENT'].includes(w.code));
    const validation={hard_constraints:'PASS' as const,data_complete:dataComplete,coverage_complete:state.result.shortages.length===0,coverage:state.result.coverage,issues:[],warnings:summary.warnings};
    const assignments=state.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
    const prepared=buildAISummary({scope:'preview',rule_snapshot:state.snapshot,assignments,validation});
    const report=parseAIReport(await advisor.evaluate(prepared.summary));
    // Preview evaluation is text advice only. Do not implement/apply AI adjustments.
    if(report.suggestions.some(s=>s.candidate_assignments!==null))throw new ScheduleError(502,'AI_INVALID_RESPONSE','Đánh giá preview chỉ hỗ trợ gợi ý bằng lời; chưa có phương án AI để áp dụng.');
    assertAIConclusion(report,validation);
    // Reload and re-review after provider latency. No evaluation repository/writer.
    await inspectPreview(periodId,branchId,body,repository);
    return {...base,status:'AVAILABLE',message:'AI đã đánh giá lịch dự kiến chưa lưu. Phân công không thay đổi.',evaluation:{scope:'preview',contract_version:'tv3-ai.v1',input_revision:planRevision,created_at:new Date().toISOString(),employee_aliases:prepared.aliases,labels:prepared.labels,missing_criteria:prepared.summary.missing_criteria,
      report:{...report,suggestions:report.suggestions.map(s=>({...s,rule_check:{status:'NOT_APPLICABLE',code:null,message:'Gợi ý tư vấn, không tự thay đổi phân công.'}}))}}};
  }finally{pending.delete(lock);}
}
