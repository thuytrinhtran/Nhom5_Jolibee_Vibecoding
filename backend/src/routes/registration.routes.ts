import { requireEmployeeOwner } from '../middleware/data-scope.middleware.js';
import { effectivePeriodStatus } from '../registrations/period-status.js';
import { Router } from 'express';
import { supabaseAdmin as db } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { parsePreferences, validatePreferences, RegistrationError } from '../registrations/validation.js';

export const registrationRoutes = Router();
registrationRoutes.use(authenticate, requireRole(['NV']));
registrationRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
registrationRoutes.use(async (req, res, next) => {
  try {
    const { data: employee, error } = await db.from('employees').select('id, user_id, full_name, branch_id, department_id, skill_level, status').eq('user_id', req.user!.id).maybeSingle();
    if (error) throw error;
    if (!employee || employee.status !== 'ACTIVE' || employee.branch_id !== req.user!.branch_id) return res.status(403).json({ status: 'error', message: 'Hồ sơ nhân viên hoặc chi nhánh chưa hợp lệ.' });
    if (employee.skill_level === 'CREW_LEADER') return res.status(403).json({ status: 'error', message: 'Crew Leader có lịch do quản lý thiết lập, không đăng ký nguyện vọng.' });
    res.locals.employee = employee;
    next();
  } catch { res.status(503).json({ status: 'error', message: 'Không thể đọc hồ sơ nhân viên.' }); }
});
registrationRoutes.use((req,res,next) => requireEmployeeOwner(() => res.locals.employee.id)(req,res,next));
registrationRoutes.get('/current', async (req, res) => {
  try {
    const employee = res.locals.employee;
    const now = new Date().toISOString();
    const active = await db.from('registration_periods').select('*').eq('branch_id', employee.branch_id).lte('open_at', now).gt('close_at', now).order('work_start_date').limit(1);
    if (active.error) throw active.error;
    let period = active.data?.[0] || null;
    if (!period) {
      const upcoming = await db.from('registration_periods').select('*').eq('branch_id', employee.branch_id).gt('open_at', now).gt('close_at', now).order('open_at').limit(1);
      if (upcoming.error) throw upcoming.error;
      period = upcoming.data?.[0] || null;
    }
    if (!period) {
      const recent = await db.from('registration_periods').select('*').eq('branch_id', employee.branch_id).order('work_start_date', { ascending: false }).limit(1);
      if (recent.error) throw recent.error;
      period = recent.data?.[0] || null;
    }
    if (period) period = { ...period, stored_status: period.status, status: effectivePeriodStatus(period, Date.parse(now)) };
    const shiftResult = await db.from('shifts').select('id,name,start_time,end_time').eq('is_active', true).or(`branch_id.is.null,branch_id.eq.${employee.branch_id}`).order('start_time');
    if (shiftResult.error) throw shiftResult.error;
    const config = await db.from('registration_schedule_config').select('timezone,open_iso_day,open_local_time,close_iso_day,close_local_time,reminder_minutes').eq('singleton', true).single();
    if (config.error) throw config.error;
    let registrations: unknown[] = [], submission = null, hasSampleData = false;
    if (period) {
      const [r, s] = await Promise.all([
        db.from('shift_registrations').select('work_date,shift_id,status,submitted_at').eq('period_id', period.id).eq('employee_id', employee.id),
        db.from('registration_submissions_sourced').select('status,errors,submitted_at,updated_at,sample_batch_id').eq('period_id', period.id).eq('employee_id', employee.id).maybeSingle(),
      ]);
      if (r.error || s.error) throw r.error || s.error;
      hasSampleData = !!s.data?.sample_batch_id;
      // Administrative TV3 fixtures must never look like this employee submitted them.
      registrations = hasSampleData ? [] : r.data || []; submission = hasSampleData ? null : s.data;
    }
    res.json({ status: 'ok', employee: { ...employee, branch_name: req.user!.branch_name, department_name: req.user!.employee?.department_name }, period, shifts: shiftResult.data, registrations, submission, has_sample_data: hasSampleData, schedule: config.data, server_now: new Date().toISOString() });
  } catch (error) {
    // Log only a bounded error code, never tokens, request bodies or database details.
    const rawCode = (error as { code?: unknown })?.code;
    const code = typeof rawCode === 'string' && /^[A-Z0-9]{4,12}$/.test(rawCode) ? rawCode : 'DEPENDENCY_ERROR';
    console.error('[Registrations/current] Dependency failed:', code);
    const schemaNotReady = ['42703','42P01','PGRST205','PGRST202'].includes(code);
    res.status(503).json({ status: 'error', code: schemaNotReady ? 'REGISTRATION_SCHEMA_NOT_READY' : 'REGISTRATION_UNAVAILABLE', message: schemaNotReady ? 'Cấu trúc dữ liệu đăng ký chưa đồng bộ. Vui lòng liên hệ quản trị viên.' : 'Không tải được đăng ký. Vui lòng thử lại hoặc liên hệ quản trị viên.' });
  }
});
registrationRoutes.put('/:periodId/me', async (req, res) => {
  try {
    if (!uuid.test(req.params.periodId)) throw new RegistrationError('Mã đợt không hợp lệ.', 400);
    const { preferences, mode } = parsePreferences(req.body);
    const employee = res.locals.employee;
    const p = await db.from('registration_periods').select('*').eq('id', req.params.periodId).eq('branch_id', employee.branch_id).maybeSingle();
    if (p.error) throw p.error;
    if (!p.data) throw new RegistrationError('Không có quyền truy cập đợt đăng ký.', 403);
    const now = Date.now();
    if (effectivePeriodStatus(p.data, now) !== 'OPEN') throw new RegistrationError('Đợt chưa mở hoặc đã đóng; không thể chỉnh sửa.', 409);
    const s = await db.from('shifts').select('id,start_time,end_time').eq('is_active', true).or(`branch_id.is.null,branch_id.eq.${employee.branch_id}`);
    if (s.error) throw s.error;
    const errors = validatePreferences(preferences, s.data || [], p.data.work_start_date, p.data.work_end_date);
    if (errors.length) return res.status(400).json({ status: 'error', message: errors.join(' '), errors });
    const result = await db.rpc('save_employee_registration', { p_user: req.user!.id, p_period: p.data.id, p_preferences: preferences, p_submit: mode === 'submit' });
    if (result.error) {
      if (result.error.code === 'P0001') throw new RegistrationError(result.error.message, 409);
      throw result.error;
    }
    const valid = result.data.registration_status !== 'INVALID';
    res.status(valid ? 200 : 422).json({ ...result.data, status: valid ? 'ok' : 'error', message: valid ? (mode === 'draft' ? 'Đã lưu nháp.' : 'Đã gửi đăng ký hợp lệ.') : 'Đăng ký cần bổ sung thông tin.' });
  } catch (error) {
    res.status(error instanceof RegistrationError ? error.status : 503).json({ status: 'error', message: error instanceof RegistrationError ? error.message : 'Không lưu được đăng ký. Vui lòng thử lại.' });
  }
});
