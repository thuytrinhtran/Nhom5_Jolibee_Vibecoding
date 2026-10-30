import { authService, ApiError } from './auth.service';
import type { AIReviewResponse, ApprovalHandoff, ScheduleValidation, DemandContext, DemandInput, DemandRequirement, ScheduleAssignment, RegistrationSummary, SavedSchedule, SchedulingContext, SchedulingPeriod } from '../types/scheduling';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Reuse existing session validation/refresh; keep login and token storage unchanged.
  await authService.getMe();
  const send = async () => {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/schedules${path}`, { ...options,
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
    if (data?.status !== 'ok') throw new ApiError('Phản hồi xếp lịch không hợp lệ.', 502);
    return data as T;
  };
  try { return await send(); } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await authService.getMe();
    return send();
  }
}
export const schedulingService = {
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
