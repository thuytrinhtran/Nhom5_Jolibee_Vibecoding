import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scheduleSelect = 'id,schedule_group_id,branch_id,period_id,version,status,created_by,created_at,published_at,feedback_deadline_at,branches(id,name),registration_periods(work_start_date,work_end_date),shift_assignments(id,work_date,status,assignment_source,shift_id,employee_id,department_id,employees(id,full_name,department_id,departments(name)),shifts(id,name,start_time,end_time),departments(id,name))';

type ResubmitAssignmentInput = { source_assignment_id: string; shift_id: string };
type ResubmitInput = { expected_version: number; adjustment_note: string; assignments: ResubmitAssignmentInput[] };

function validateResubmitInput(body: unknown): { value?: ResubmitInput; error?: { code: string; message: string } } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'INVALID_RESUBMIT_REQUEST', message: 'Nội dung trình lại lịch không hợp lệ.' } };
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !['expected_version', 'adjustment_note', 'assignments'].includes(key))) {
    return { error: { code: 'INVALID_RESUBMIT_REQUEST', message: 'Request chỉ hỗ trợ expected_version, adjustment_note và assignments.' } };
  }
  if (!Number.isSafeInteger(value.expected_version) || Number(value.expected_version) < 1) {
    return { error: { code: 'INVALID_RESUBMIT_REQUEST', message: 'expected_version phải là số nguyên dương an toàn.' } };
  }
  if (typeof value.adjustment_note !== 'string' || !value.adjustment_note.trim()) {
    return { error: { code: 'ADJUSTMENT_NOTE_REQUIRED', message: 'Vui lòng nhập ghi chú điều chỉnh.' } };
  }
  if (!Array.isArray(value.assignments) || value.assignments.length === 0) {
    return { error: { code: 'INVALID_ASSIGNMENTS', message: 'Cần ít nhất một phân công đã điều chỉnh.' } };
  }

  const seen = new Set<string>();
  const assignments: ResubmitAssignmentInput[] = [];
  for (const item of value.assignments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: { code: 'INVALID_ASSIGNMENTS', message: 'Thông tin phân công không hợp lệ.' } };
    }
    const assignment = item as Record<string, unknown>;
    if (Object.keys(assignment).some(key => !['source_assignment_id', 'shift_id'].includes(key))
      || typeof assignment.source_assignment_id !== 'string' || !uuid.test(assignment.source_assignment_id)
      || typeof assignment.shift_id !== 'string' || !uuid.test(assignment.shift_id)
      || seen.has(assignment.source_assignment_id)) {
      return { error: { code: 'INVALID_ASSIGNMENTS', message: 'Mã phân công nguồn hoặc ca không hợp lệ, hoặc bị lặp.' } };
    }
    seen.add(assignment.source_assignment_id);
    assignments.push({ source_assignment_id: assignment.source_assignment_id, shift_id: assignment.shift_id });
  }

  return { value: {
    expected_version: Number(value.expected_version),
    adjustment_note: value.adjustment_note.trim(),
    assignments,
  } };
}

export function markLatestVersions<T extends { schedule_group_id: string; version: number }>(
  schedules: T[],
  versions: Array<{ schedule_group_id: string; version: number }>,
): Array<T & { is_latest: boolean }> {
  const latestByGroup = new Map<string, number>();
  for (const row of versions) {
    latestByGroup.set(row.schedule_group_id, Math.max(latestByGroup.get(row.schedule_group_id) || 0, row.version));
  }
  return schedules.map(row => ({ ...row, is_latest: latestByGroup.get(row.schedule_group_id) === row.version }));
}

router.use(authenticate);

router.get('/', async (req, res) => {
  if (!req.user || !['GS', 'QL'].includes(req.user.role)) return res.status(403).json({ message: 'Không có quyền xem lịch.' });
  const view = String(req.query.view || '');
  const statuses = view === 'pending' && req.user.role === 'GS' ? ['PENDING_APPROVAL']
    : view === 'history' && req.user.role === 'GS' ? ['APPROVED', 'NEEDS_REVISION']
    : view === 'publishable' && req.user.role === 'QL' ? ['APPROVED', 'PUBLISHED', 'NEEDS_REVISION'] : null;
  if (!statuses) return res.status(400).json({ message: 'Bộ lọc lịch không hợp lệ.' });
  try {
    let query = supabaseAdmin.from('schedules').select(scheduleSelect).in('status', statuses).order('created_at', { ascending: false });
    if (req.user.role === 'QL') {
      if (!req.user.branch_id) return res.json({ schedules: [] });
      query = query.eq('branch_id', req.user.branch_id);
    } else {
      const { data: branches, error: branchError } = await supabaseAdmin.from('branches').select('id').eq('supervisor_id', req.user.id);
      if (branchError) throw branchError;
      const ids = (branches || []).map(branch => branch.id);
      if (!ids.length) return res.json({ schedules: [] });
      query = query.in('branch_id', ids);
    }
    const { data, error } = await query;
    if (error) throw error;
    const schedules = data || [];
    const ids = schedules.map(schedule => schedule.id);
    let approvals: any[] = [];
    let versions: Array<{ schedule_group_id: string; version: number }> = [];
    if (ids.length) {
      const result = await supabaseAdmin.from('schedule_approvals')
        .select('id,schedule_id,supervisor_id,decision,reason,decided_at,users:supervisor_id(username)')
        .in('schedule_id', ids).order('decided_at', { ascending: false });
      if (result.error) throw result.error;
      approvals = result.data || [];

      const groupIds = [...new Set(schedules.map(schedule => schedule.schedule_group_id))];
      const versionResult = await supabaseAdmin.from('schedules')
        .select('schedule_group_id,version').in('schedule_group_id', groupIds);
      if (versionResult.error) throw versionResult.error;
      versions = versionResult.data || [];
    }
    const withLatest = markLatestVersions(schedules, versions);
    return res.json({ schedules: withLatest.map(schedule => ({
      ...schedule,
      approvals: approvals.filter(approval => approval.schedule_id === schedule.id),
    })) });
  } catch (error: any) {
    console.error('[Schedule workflow] Load failed:', error.code || error.message);
    return res.status(503).json({ message: 'Không thể tải dữ liệu lịch. Kiểm tra schema đã triển khai và kết nối cơ sở dữ liệu.' });
  }
});

router.get('/:id/history', requireRole(['GS']), async (req, res) => {
  try {
    const { data: schedule, error: scheduleError } = await supabaseAdmin.from('schedules')
      .select('id,branch_id,schedule_group_id,version').eq('id', req.params.id).maybeSingle();
    if (scheduleError) throw scheduleError;
    if (!schedule) return res.status(404).json({ message: 'Không tìm thấy lịch.' });
    const { data: assignedBranch, error: scopeError } = await supabaseAdmin.from('branches')
      .select('id').eq('id', schedule.branch_id).eq('supervisor_id', req.user!.id).maybeSingle();
    if (scopeError) throw scopeError;
    if (!assignedBranch) return res.status(403).json({ message: 'Lịch nằm ngoài phạm vi được phân công.' });
    const { data: versions, error: versionsError } = await supabaseAdmin.from('schedules')
      .select('id').eq('schedule_group_id', schedule.schedule_group_id);
    if (versionsError) throw versionsError;
    const scheduleIds = (versions || []).map(row => row.id);
    const { data, error } = await supabaseAdmin.from('schedule_approvals')
      .select('id,schedule_id,supervisor_id,decision,reason,decided_at,users:supervisor_id(username)')
      .in('schedule_id', scheduleIds)
      .order('decided_at', { ascending: false });
    if (error) throw error;
    return res.json({ approvals: data || [] });
  } catch (error: any) {
    console.error('[Schedule workflow] History failed:', error.code || error.message);
    return res.status(503).json({ message: 'Không thể tải lịch sử quyết định.' });
  }
});

router.post('/:id/decision', requireRole(['GS']), async (req, res) => {
  const decision = req.body?.decision;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['APPROVED', 'NEEDS_REVISION'].includes(decision)) return res.status(400).json({ message: 'Quyết định không hợp lệ.' });
  if (decision === 'NEEDS_REVISION' && !reason) return res.status(400).json({ message: 'Vui lòng nhập lý do từ chối.' });
  const { data, error } = await supabaseAdmin.rpc('tv4_decide_schedule', {
    p_schedule_id: req.params.id, p_actor_id: req.user!.id, p_decision: decision, p_reason: reason || null,
  });
  if (error) return res.status(error.message.includes('FORBIDDEN') ? 403 : error.message.includes('NOT_FOUND') ? 404 : 409)
    .json({ message: error.message.includes('STALE') ? 'Lịch đã có phiên bản mới hơn; hãy tải lại.' : 'Lịch đã được xử lý hoặc không còn ở trạng thái chờ duyệt.' });
  return res.json({ schedule: data });
});

router.post('/:id/publish', requireRole(['QL']), async (req, res) => {
  const deadline = req.body?.feedback_deadline_at;
  if (typeof deadline !== 'string' || Number.isNaN(Date.parse(deadline))) return res.status(400).json({ message: 'Vui lòng chọn thời hạn phản hồi hợp lệ.' });
  const { data, error } = await supabaseAdmin.rpc('tv4_publish_schedule', {
    p_schedule_id: req.params.id, p_actor_id: req.user!.id, p_feedback_deadline_at: deadline,
  });
  if (error) return res.status(error.message.includes('FORBIDDEN') ? 403 : error.message.includes('NOT_FOUND') ? 404 : 409)
    .json({ message: error.message.includes('STALE') ? 'Lịch đã có phiên bản mới hơn; hãy tải lại.' : 'Chỉ lịch đã phê duyệt mới được công bố.' });
  return res.json({ schedule: data });
});

// Resubmit is intentionally validation-only until TV3 and the database owner
// provide the shared transactional version allocator and persistence RPC.
router.post('/:id/resubmit', requireRole(['QL']), async (req, res) => {
  if (!uuid.test(req.params.id)) {
    return res.status(400).json({ status: 'error', code: 'INVALID_RESUBMIT_REQUEST', message: 'Mã lịch không hợp lệ.' });
  }
  const validated = validateResubmitInput(req.body);
  if (validated.error) {
    const status = validated.error.code === 'INVALID_RESUBMIT_REQUEST' ? 400 : 422;
    return res.status(status).json({ status: 'error', ...validated.error });
  }

  // Branch scope is derived only from the authenticated database profile.
  const branchId = req.user?.branch_id;
  if (!branchId) {
    return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'Tài khoản QL chưa được phân công chi nhánh.' });
  }

  try {
    const { data: source, error } = await supabaseAdmin.from('schedules')
      .select('id,branch_id').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!source) return res.status(404).json({ status: 'error', code: 'SCHEDULE_NOT_FOUND', message: 'Không tìm thấy lịch nguồn.' });
    if (source.branch_id !== branchId) {
      return res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'Lịch nằm ngoài chi nhánh được phân công.' });
    }
  } catch (error: any) {
    console.error('[Schedule workflow] Resubmit scope check failed:', error.code || error.message);
    return res.status(503).json({ status: 'error', code: 'RESUBMIT_VALIDATION_UNAVAILABLE', message: 'Không thể xác minh phạm vi lịch. Vui lòng thử lại.' });
  }

  // Do not call an unverified RPC or report a successful resubmission.
  return res.status(501).json({
    status: 'error',
    code: 'RESUBMIT_NOT_CONFIGURED',
    message: 'Chức năng trình lại lịch chưa được cấu hình trên backend.',
  });
});

export default router;
