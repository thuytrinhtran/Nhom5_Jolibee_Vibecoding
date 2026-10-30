import { authorized, ApiError } from './auth.service';
import type { AssignmentsResult, CandidatesResult, DecisionResult, EmployeeInvitation, ResponseResult, SearchResult, ShiftChangeRequest } from '../types/shift-change';

type Transport = typeof authorized;
const prefix = '/shift-change-requests';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = () => new ApiError('Dữ liệu đổi ca trả về không hợp lệ. Hãy tải lại để kiểm tra kết quả.', 502, 'INVALID_API_RESPONSE');
const textFields = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const time = (v: unknown) => typeof v === 'string' && /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(v);
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const assignment = (v: unknown): v is Record<string, unknown> => object(v) && textFields(v, ['id', 'schedule_id', 'employee_id', 'work_date'])
  && /^\d{4}-\d{2}-\d{2}$/.test(v.work_date as string) && Number.isFinite(Date.parse(`${v.work_date}T00:00:00+07:00`));
const shift = (v: unknown) => object(v) && typeof v.name === 'string' && time(v.start_time) && time(v.end_time);
const invitation = (v: unknown): v is Record<string, unknown> => object(v) && textFields(v, ['id', 'target_employee_id'])
  && ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(String(v.status))
  && ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(String(v.effective_status)) && instant(v.expires_at);
const request = (v: unknown) => object(v) && textFields(v, ['id', 'reason', 'requesting_employee_name', 'schedule_state'])
  && ['PENDING', 'SEARCHING', 'APPROVED', 'REJECTED'].includes(String(v.status)) && instant(v.created_at)
  && (v.resolved_at === null || instant(v.resolved_at)) && assignment(v.original_assignment) && shift(v.shift)
  && Array.isArray(v.invitations) && v.invitations.every(i => invitation(i) && typeof i.full_name === 'string' && typeof i.eligible_now === 'boolean');

export function createShiftChangeService(transport: Transport = authorized) {
  async function call<T>(path: string, check: (value: Record<string, unknown>) => boolean, body?: object): Promise<T> {
    const response: unknown = await transport(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, prefix);
    if (!object(response) || response.status !== 'ok' || !object(response.result) || !check(response.result)) throw invalid();
    return response.result as T;
  }
  const search = (v: Record<string, unknown>) => typeof v.request_id === 'string'
    && ['invitations_created', 'accepted_count', 'pending_count'].every(k => typeof v[k] === 'number')
    && (v.warning === null || v.warning === 'NO_AVAILABLE_REPLACEMENT');
  return {
    assignments: () => call<AssignmentsResult>('/assignments', v => Array.isArray(v.assignments)
      && v.assignments.every(a => assignment(a) && shift(a.shift) && instant(a.request_deadline_at))
      && Array.isArray(v.schedule_issues) && v.schedule_issues.every(i => object(i) && textFields(i, ['schedule_id', 'code']))),
    requests: () => call<{ requests: ShiftChangeRequest[] }>('', v => Array.isArray(v.requests) && v.requests.every(request)),
    invitations: () => call<{ invitations: EmployeeInvitation[] }>('/invitations', v => Array.isArray(v.invitations)
      && v.invitations.every(i => invitation(i) && assignment(i.assignment) && typeof i.shift_name === 'string' && time(i.start_time) && time(i.end_time))),
    candidates: (assignmentId: string) => call<CandidatesResult>(`/assignments/${encodeURIComponent(assignmentId)}/candidates`, v =>
      v.assignment_id === assignmentId && instant(v.request_deadline_at) && Array.isArray(v.candidates)
      && v.candidates.every(c => object(c) && typeof c.employee_id === 'string' && typeof c.full_name === 'string')),
    create: (assignmentId: string, reason: string, proposedEmployeeId?: string) => call<SearchResult>('', search, {
      original_assignment_id: assignmentId, reason: reason.trim(), ...(proposedEmployeeId ? { proposed_employee_id: proposedEmployeeId } : {}),
    }),
    respond: (id: string, response: 'ACCEPTED' | 'DECLINED') => call<ResponseResult>(`/invitations/${encodeURIComponent(id)}/response`,
      v => search(v) && typeof v.response_recorded === 'boolean' && (v.expired === undefined || typeof v.expired === 'boolean'), { response }),
    decide: (id: string, decision: 'APPROVED' | 'REJECTED', employeeId?: string, reason?: string) => call<DecisionResult>(`/${encodeURIComponent(id)}/decision`,
      v => typeof v.request_id === 'string' && v.decision === decision && (v.new_assignment_id === null || typeof v.new_assignment_id === 'string'),
      { decision, ...(decision === 'APPROVED' ? { replacement_employee_id: employeeId } : {}), ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
    refresh: (id: string) => call<SearchResult>(`/${encodeURIComponent(id)}/refresh`, search, {}),
  };
}
export const shiftChangeService = createShiftChangeService();
