import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
const scheduleSelect = 'id,schedule_group_id,branch_id,period_id,version,status,created_at,published_at,feedback_deadline_at,branches(name),registration_periods(work_start_date,work_end_date),shift_assignments(id,work_date,status,assignment_source,employees(full_name,department_id,departments(name)),shifts(name,start_time,end_time),departments(name))';

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
    if (ids.length) {
      const result = await supabaseAdmin.from('schedule_approvals')
        .select('id,schedule_id,supervisor_id,decision,reason,decided_at,users:supervisor_id(username)')
        .in('schedule_id', ids).order('decided_at', { ascending: false });
      if (result.error) throw result.error;
      approvals = result.data || [];
    }
    return res.json({ schedules: schedules.map(schedule => ({
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

export default router;
