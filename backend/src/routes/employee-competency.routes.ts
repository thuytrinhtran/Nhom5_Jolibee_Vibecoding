import { Router } from 'express';
import { supabaseAdmin as db } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { requireBranchScope } from '../middleware/data-scope.middleware.js';

const levels = new Set(['NEW', 'REGULAR', 'CREW_TRAINING', 'CREW_LEADER']);
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const employeeCompetencyRoutes = Router();
employeeCompetencyRoutes.use(authenticate, requireRole(['QL']));
employeeCompetencyRoutes.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.user?.branch_id) return res.status(403).json({ status: 'error', message: 'Quản lý chưa được phân công chi nhánh.' });
  next();
});
employeeCompetencyRoutes.get('/', async (req, res) => {
  try {
    const employees: unknown[] = [];
    for (let from = 0; ; from += 500) {
      const result = await db.from('employees')
        .select('id,full_name,branch_id,department_id,skill_level,user:user_id(username),branch:branch_id(name),department:department_id(name)')
        .eq('branch_id', req.user!.branch_id!).order('full_name').order('id').range(from, from + 499);
      if (result.error) throw result.error;
      const rows = result.data || [];
      employees.push(...rows.map(row => {
        const relation = (value: unknown) => (Array.isArray(value) ? value[0] : value) as { name?: string; username?: string } | null;
        return { id: row.id, employee_code: relation(row.user)?.username || '', full_name: row.full_name,
          branch_id: row.branch_id, branch_name: relation(row.branch)?.name || '',
          department_id: row.department_id, department_name: relation(row.department)?.name || '', skill_level: row.skill_level };
      }));
      if (rows.length < 500) break;
    }
    res.json({ status: 'ok', employees });
  } catch {
    res.status(503).json({ status: 'error', message: 'Không tải được danh sách nhân viên. Vui lòng thử lại.' });
  }
});
employeeCompetencyRoutes.patch('/:id/skill-level', async (req, res, next) => {
  const body = req.body;
  if (!uuid.test(req.params.id) || !body || Array.isArray(body) ||
    Object.keys(body).some(key => !['skill_level', 'expected_skill_level'].includes(key)) ||
    !levels.has(body.skill_level) || (body.expected_skill_level !== undefined && !levels.has(body.expected_skill_level))) {
    return res.status(400).json({ status: 'error', message: 'Chỉ chấp nhận cấp độ NEW, REGULAR, CREW_TRAINING hoặc CREW_LEADER.' });
  }
  try {
    const result = await db.from('employees').select('id,branch_id,skill_level').eq('id', req.params.id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return res.status(404).json({ status: 'error', message: 'Không tìm thấy nhân viên.' });
    res.locals.employee = result.data;
    next();
  } catch {
    res.status(503).json({ status: 'error', message: 'Không kiểm tra được hồ sơ nhân viên. Vui lòng thử lại.' });
  }
}, (req, res, next) => requireBranchScope(() => res.locals.employee.branch_id)(req, res, next), async (req, res) => {
  try {
    const expected = req.body.expected_skill_level ?? res.locals.employee.skill_level;
    // Only skill_level is writable. Recheck branch and previous level in the UPDATE.
    const result = await db.from('employees').update({ skill_level: req.body.skill_level })
      .eq('id', req.params.id).eq('branch_id', req.user!.branch_id!).eq('skill_level', expected)
      .select('id,skill_level').maybeSingle();
    if (result.error) return res.status(503).json({ status: 'error', message: result.error.code === '42501'
      ? 'Backend chưa có quyền cập nhật năng lực trên database. Vui lòng liên hệ quản trị viên.'
      : 'Không cập nhật được năng lực. Vui lòng tải lại danh sách để kiểm tra trước khi thử lại.' });
    if (!result.data) return res.status(409).json({ status: 'error', message: 'Hồ sơ hoặc cấp độ đã thay đổi. Vui lòng tải lại danh sách.' });
    res.json({ status: 'ok', employee: result.data, message: 'Đã cập nhật năng lực nhân viên.' });
  } catch {
    res.status(503).json({ status: 'error', message: 'Chưa xác nhận được kết quả cập nhật. Vui lòng tải lại danh sách.' });
  }
});
