import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

// Attach AFTER authenticate + requireRole. Resource IDs must come from the fetched
// database row, never solely from a client-supplied branch_id/employee_id.
export function requireEmployeeOwner(employeeId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập.' });
    if (req.user.must_change_password !== false || req.user.role !== 'NV' || !employeeId(req) || employeeId(req) !== req.user.employee?.id) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền truy cập dữ liệu nhân viên này.' });
    }
    next();
  };
}

export function requireBranchScope(branchId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập.' });
    const id = branchId(req);
    if (req.user.must_change_password !== false || !id) return res.status(403).json({ status: 'error', message: 'Không xác định được phạm vi truy cập.' });
    if (req.user.role === 'QL' && id === req.user.branch_id) return next();
    if (req.user.role === 'GS') {
      try {
        const { data, error } = await supabaseAdmin.from('branches').select('id').eq('id', id).eq('supervisor_id', req.user.id).maybeSingle();
        if (error) return res.status(503).json({ status: 'error', message: 'Chưa thể kiểm tra phạm vi chi nhánh. Vui lòng thử lại.' });
        if (data) return next();
      } catch {
        return res.status(503).json({ status: 'error', message: 'Chưa thể kiểm tra phạm vi chi nhánh. Vui lòng thử lại.' });
      }
    }
    return res.status(403).json({ status: 'error', message: 'Bạn không có quyền truy cập chi nhánh này.' });
  };
}
