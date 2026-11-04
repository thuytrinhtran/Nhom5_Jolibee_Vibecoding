import type { AdjustmentIntent, AdjustmentProposal, ScheduleRevisionRecord } from '../types/scheduling';
import { authService, ApiError,fetchWithReadDedupe } from './auth.service';
import type { ManagerCalendarData,OfficialCalendarData } from '../types/manager-calendar';
import type { SchedulePreview, PreviewAIReviewResponse, PreviewAIConfiguration } from '../types/scheduling';
import type { AIReviewResponse, ApprovalHandoff, ScheduleValidation, DemandContext, DemandInput, DemandRequirement, ScheduleAssignment, RegistrationSummary, SavedSchedule, SchedulingContext, SchedulingPeriod } from '../types/scheduling';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
async function request<T>(path: string, options: RequestInit = {}, workflowList = false): Promise<T> {
  // Reuse existing session validation/refresh; keep login and token storage unchanged.
  if(authService.ensureSession)await authService.ensureSession();else await authService.getMe();
  const send = async () => {
    let response: Response;
    try {
      response = await (fetchWithReadDedupe??fetch)(`${API_URL}/schedules${path}`, { ...options,
        headers: { ...options.headers, Authorization: `Bearer ${authService.getStoredToken() || ''}` },
        signal: AbortSignal.timeout(60000), cache: 'no-store' });
    } catch {
      throw new ApiError('Không kết nối được dịch vụ xếp lịch hoặc yêu cầu đã hết thời gian. Hãy tải lại tuần để kiểm tra lịch đã lưu trước khi thử tạo lại.', 0);
    }
    let data;
    try { data = await response.json(); } catch {
      throw new ApiError(`API xếp lịch trả về dữ liệu không hợp lệ (HTTP ${response.status}).`, response.status);
    }
    if (!response.ok) throw new ApiError(data?.message || 'Không thể xử lý yêu cầu xếp lịch.', response.status, data?.code);
    if (!workflowList && data?.status !== 'ok') throw new ApiError('Phản hồi xếp lịch không hợp lệ.', 502);
    return data as T;
  };
  try { return await send(); } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await authService.getMe();
    return send();
  }
}
export const schedulingService = {
  async revisionHistory():Promise<ScheduleRevisionRecord[]> {
    // TV4 list returns {schedules}, unlike TV3's {status:'ok',result} envelope.
    const data=await request<{schedules:ScheduleRevisionRecord[]}>('/workflow?view=publishable',{},true);
    if(!Array.isArray(data?.schedules))throw new ApiError('Không tải được lịch sử yêu cầu chỉnh sửa.',502);
    return data.schedules;
  },
  async officialCalendar(period:string,filters:Record<string,string|number|boolean>={}):Promise<OfficialCalendarData>{
    const query=Object.entries(filters).filter(([,v])=>v!=='').map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    return(await request<{result:OfficialCalendarData}>(`/periods/${encodeURIComponent(period)}/official-calendar?${query}`)).result;
  },
  async previewAIConfiguration():Promise<PreviewAIConfiguration> {
    return(await request<{result:PreviewAIConfiguration}>('/preview/ai-evaluation')).result;
  },
  async applyAdjustment(preview:SchedulePreview,proposal:AdjustmentProposal):Promise<SchedulePreview> {
    const plain=({employee_id,work_date,shift_id,department_id}:ScheduleAssignment)=>({employee_id,work_date,shift_id,department_id});
    return(await request<{result:SchedulePreview}>('/preview/apply-adjustment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id:preview.period.id,input_revision:preview.input_revision,assignments:preview.result.assignments.map(plain),proposal_assignments:proposal.result.assignments.map(plain),proposal_token:proposal.proposal_token,...(preview.edit_target?{schedule_id:preview.edit_target.id,expected_version:preview.edit_target.version}:{})})})).result;
  },
  async proposeAdjustment(preview:SchedulePreview,analysis_token:string):Promise<AdjustmentProposal> {
    const assignments=preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
    return(await request<{result:AdjustmentProposal}>('/preview/adjustment-proposal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id:preview.period.id,input_revision:preview.input_revision,assignments,analysis_token,...(preview.edit_target?{schedule_id:preview.edit_target.id,expected_version:preview.edit_target.version}:{})})})).result;
  },
  async analyzeAdjustment(preview:SchedulePreview,wish:string):Promise<AdjustmentIntent> {
    const assignments=preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
    return(await request<{result:AdjustmentIntent}>('/preview/adjustment-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id:preview.period.id,input_revision:preview.input_revision,assignments,wish,...(preview.edit_target?{schedule_id:preview.edit_target.id,expected_version:preview.edit_target.version}:{})})})).result;
  },
  async evaluatePreviewAI(preview:SchedulePreview):Promise<PreviewAIReviewResponse> {
    const assignments=preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
    return(await request<{result:PreviewAIReviewResponse}>('/preview/ai-evaluation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id:preview.period.id,input_revision:preview.input_revision,assignments,...(preview.edit_target?{schedule_id:preview.edit_target.id,expected_version:preview.edit_target.version}:{})})})).result;
  },
  async preview(period_id:string,edit?:{input_revision?:string;assignments?:ScheduleAssignment[];schedule_id?:string;expected_version?:number;use_saved_assignments?:true}):Promise<SchedulePreview> {
    return(await request<{result:SchedulePreview}>('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id,...edit})})).result;
  },
  async savePreview(period_id:string,input:{input_revision:string;assignments:ScheduleAssignment[];request_id:string},target?:{id:string;version:number}|null):Promise<{id:string}> {
    const data=await request<{result:{schedule:{id:string}}}>(target?`/${encodeURIComponent(target.id)}/draft-assignments`:'/drafts',{
      method:target?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_id,...input,...(target?{expected_version:target.version}:{})})});
    return {id:data.result.schedule.id};
  },
  async calendar(periodId:string):Promise<ManagerCalendarData> {
    return (await request<{result:ManagerCalendarData}>(`/periods/${encodeURIComponent(periodId)}/calendar`)).result;
  },
  async aiEvaluation(id:string,expected_version:number):Promise<AIReviewResponse> {
    return(await request<{result:AIReviewResponse}>(`/${encodeURIComponent(id)}/ai-evaluation?expected_version=${expected_version}`)).result;
  },
  async evaluateAI(id:string,expected_version:number):Promise<AIReviewResponse> {
    return(await request<{result:AIReviewResponse}>(`/${encodeURIComponent(id)}/ai-evaluation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version})})).result;
  },
  async clearDemand(periodId:string,input:Pick<DemandInput,'work_date'|'shift_id'|'department_id'|'expected_updated_at'>):Promise<void> {
    await request(`/periods/${encodeURIComponent(periodId)}/requirements`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  },
  async validate(id:string,expected_version:number):Promise<ScheduleValidation>{
    return(await request<{result:ScheduleValidation}>(`/${encodeURIComponent(id)}/validate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version})})).result;
  },
  async prepareHandoff(id:string,expected_version:number,note:string):Promise<ApprovalHandoff>{
    return(await request<{result:ApprovalHandoff}>(`/${encodeURIComponent(id)}/approval-handoff`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version,note})})).result;
  },
  async submitApproval(id:string,expected_version:number,note:string,request_id:string):Promise<{schedule:SavedSchedule['schedule'];reused:boolean}>{
    return request(`/workflow/${encodeURIComponent(id)}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version,note,request_id})});
  },
  async demand(periodId: string): Promise<DemandContext> {
    return (await request<{result:DemandContext}>(`/periods/${encodeURIComponent(periodId)}/requirements`)).result;
  },
  async saveDemand(periodId: string, input: DemandInput): Promise<{source:'mock'|'supabase';is_mock:boolean;requirement:DemandRequirement}> {
    return (await request<{result:{source:'mock'|'supabase';is_mock:boolean;requirement:DemandRequirement}}>(`/periods/${encodeURIComponent(periodId)}/requirements`, {
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),
    })).result;
  },
  async summary(periodId: string): Promise<RegistrationSummary> {
    return (await request<{ result: RegistrationSummary }>(`/periods/${encodeURIComponent(periodId)}/registrations-summary`)).result;
  },
  async periods(): Promise<SchedulingPeriod[]> {
    return (await request<{ periods: SchedulingPeriod[] }>('/periods')).periods;
  },
  async context(periodId: string): Promise<SchedulingContext> {
    return (await request<{ result: SchedulingContext }>(`/periods/${encodeURIComponent(periodId)}`)).result;
  },
  async editDraft(id:string,input:{expected_version:number;assignments:ScheduleAssignment[];note?:string}) {
    return (await request<{result:{schedule:SavedSchedule['schedule']}}>(`/${encodeURIComponent(id)}/draft-assignments`,{
      method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),
    })).result;
  },
  async generate(periodId: string, options?:{regenerate:boolean;expected_version:number}): Promise<{ id: string; reused: boolean }> {
    const data = await request<{ reused: boolean; result: { schedule: { id: string } } }>('/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_id: periodId, ...options }),
    });
    return { id: data.result.schedule.id, reused: data.reused };
  },
  async read(id: string): Promise<SavedSchedule> {
    return (await request<{ result: SavedSchedule }>(`/${encodeURIComponent(id)}`)).result;
  },
};
