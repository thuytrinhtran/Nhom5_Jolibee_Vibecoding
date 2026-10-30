import { authService } from '../../services/auth.service';
import type {
  ScheduleApproval, ScheduleAssignment, ScheduleDecision, ScheduleWorkflowActor,
  ScheduleWorkflowRecord, ScheduleWorkflowService, ScheduleWorkflowView,
} from './scheduleWorkflow.types';
import { ScheduleWorkflowError } from './scheduleWorkflow.types';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

type ApiDependencies = {
  fetcher?: typeof fetch;
  getToken?: () => string | null;
  refreshSession?: () => Promise<unknown>;
};

type ApiRow = Record<string, any>;

const one = <T,>(value: T | T[] | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value || undefined;

function apiError(status: number, message: string, code?: string): ScheduleWorkflowError {
  const fallback = status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'
    : status === 403 ? 'Tài khoản không có quyền thực hiện thao tác này.'
      : status >= 500 ? 'Backend tạm thời không xử lý được yêu cầu TV4.'
        : 'Yêu cầu TV4 không hợp lệ.';
  return new ScheduleWorkflowError(message || fallback, code || `HTTP_${status}`, status);
}

function normalizeApproval(row: ApiRow): ScheduleApproval {
  const user = one<ApiRow>(row.users);
  return {
    id: row.id,
    schedule_id: row.schedule_id,
    supervisor_id: row.supervisor_id,
    decision: row.decision,
    reason: row.reason ?? null,
    decided_at: row.decided_at,
    users: { username: user?.username || 'Giám sát' },
  };
}

function normalizeSchedule(row: ApiRow): ScheduleWorkflowRecord {
  const branch = one<ApiRow>(row.branches);
  const period = one<ApiRow>(row.registration_periods);
  if (!row.id || !row.schedule_group_id || !row.branch_id || !period
    || typeof row.is_latest !== 'boolean') {
    throw new ScheduleWorkflowError('Backend chưa trả đủ dữ liệu phiên bản lịch cho TV4.', 'INVALID_API_SCHEDULE', 502);
  }

  const assignments = Array.isArray(row.shift_assignments) ? row.shift_assignments : [];
  return {
    id: row.id,
    schedule_group_id: row.schedule_group_id,
    branch_id: row.branch_id,
    period_id: row.period_id,
    version: row.version,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    published_at: row.published_at ?? null,
    // The current list API does not select these migration-dependent fields.
    // Keep them unknown instead of fabricating publication metadata.
    published_by: row.published_by ?? null,
    published_by_username: row.published_by_username ?? null,
    feedback_deadline_at: row.feedback_deadline_at ?? null,
    branches: { id: branch?.id || row.branch_id, name: branch?.name || '' },
    registration_periods: {
      work_start_date: period.work_start_date,
      work_end_date: period.work_end_date,
    },
    shift_assignments: assignments.map((assignment: ApiRow): ScheduleAssignment => {
      const employee = one<ApiRow>(assignment.employees);
      const employeeDepartment = one<ApiRow>(employee?.departments);
      const department = one<ApiRow>(assignment.departments);
      const shift = one<ApiRow>(assignment.shifts);
      return {
        id: assignment.id,
        work_date: assignment.work_date,
        status: assignment.status,
        assignment_source: assignment.assignment_source,
        employees: {
          full_name: employee?.full_name || '',
          department_id: employee?.department_id || assignment.department_id || '',
          departments: { name: employeeDepartment?.name || department?.name || '' },
        },
        shifts: {
          id: shift?.id || assignment.shift_id || '',
          name: shift?.name || '',
          start_time: shift?.start_time || '',
          end_time: shift?.end_time || '',
        },
        departments: { name: department?.name || employeeDepartment?.name || '' },
      };
    }),
    approvals: (Array.isArray(row.approvals) ? row.approvals : []).map(normalizeApproval),
    is_latest: row.is_latest,
  };
}

export function createScheduleWorkflowApiService(dependencies: ApiDependencies = {}): ScheduleWorkflowService {
  const fetcher = dependencies.fetcher || fetch;
  const getToken = dependencies.getToken || (() => authService.getStoredToken());
  const refreshSession = dependencies.refreshSession || (() => authService.getMe());

  const request = async (path: string, init: RequestInit = {}, retry401 = true): Promise<any> => {
    const token = getToken();
    if (!token) throw apiError(401, 'Vui lòng đăng nhập để sử dụng quy trình lịch.');

    let response: Response;
    let text: string;
    try {
      response = await fetcher(`${API_URL}/schedules/workflow${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(20000),
      });
      text = await response.text();
    } catch {
      throw new ScheduleWorkflowError('Không kết nối được Backend TV4. Hãy kiểm tra API và API_PROXY_TARGET.', 'NETWORK_ERROR', 0);
    }

    let body: any;
    try { body = JSON.parse(text); } catch {
      throw apiError(response.ok ? 502 : response.status, `Backend trả phản hồi không hợp lệ (HTTP ${response.status}).`);
    }
    if (response.status === 401 && retry401) {
      await refreshSession();
      return request(path, init, false);
    }
    if (!response.ok) throw apiError(response.status, body?.message, body?.code);
    return body;
  };

  const requireRole = (actor: ScheduleWorkflowActor, role: 'GS' | 'QL') => {
    if (actor.role !== role) throw apiError(403, `Thao tác này yêu cầu vai trò ${role}.`);
  };

  return {
    mode: 'api',
    async listSchedules(actor, view: ScheduleWorkflowView) {
      const isSupervisorView = view === 'pending' || view === 'history';
      requireRole(actor, isSupervisorView ? 'GS' : 'QL');
      const backendView = view === 'pending' ? 'pending' : view === 'history' ? 'history' : 'publishable';
      const result = await request(`?view=${backendView}`);
      if (!Array.isArray(result?.schedules)) throw apiError(502, 'Backend không trả danh sách lịch hợp lệ.');
      const schedules: ScheduleWorkflowRecord[] = result.schedules.map(normalizeSchedule);
      return view === 'publicationHistory' ? schedules.filter(schedule => schedule.status === 'PUBLISHED') : schedules;
    },
    async decideSchedule(actor, scheduleId, decision: ScheduleDecision, reason = '') {
      requireRole(actor, 'GS');
      if (decision === 'NEEDS_REVISION' && !reason.trim()) {
        throw apiError(400, 'Vui lòng nhập lý do từ chối.', 'REASON_REQUIRED');
      }
      const result = await request(`/${encodeURIComponent(scheduleId)}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, reason: reason.trim() || undefined }),
      });
      if (!result?.schedule) throw apiError(502, 'Backend không trả kết quả quyết định lịch hợp lệ.');
      return result.schedule as ScheduleWorkflowRecord;
    },
    async resubmitSchedule() {
      throw apiError(501, 'API điều chỉnh và trình lại lịch chưa được TV3 cung cấp.', 'RESUBMIT_API_UNAVAILABLE');
    },
    async publishSchedule(actor, scheduleId, feedbackDeadlineAt) {
      requireRole(actor, 'QL');
      const result = await request(`/${encodeURIComponent(scheduleId)}/publish`, {
        method: 'POST', body: JSON.stringify({ feedback_deadline_at: feedbackDeadlineAt }),
      });
      if (!result?.schedule) throw apiError(502, 'Backend không trả kết quả công bố lịch hợp lệ.');
      return result.schedule as ScheduleWorkflowRecord;
    },
  };
}

export const scheduleWorkflowApiService = createScheduleWorkflowApiService();
