import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AuthenticatedUser, UserRole, EmployeeInfo } from '../types/auth.types.js';

export function passwordLoginAfter(token: string, cutoff: number): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Array.isArray(payload.amr) && payload.amr.some((m: { method?: string; timestamp?: number }) => m.method === 'password' && typeof m.timestamp === 'number' && m.timestamp >= cutoff);
  } catch { return false; }
}

export async function authenticateSession(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Yêu cầu không có mã xác thực (Token). Vui lòng đăng nhập.'
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Mã xác thực không hợp lệ.'
      });
    }

    // Verify token with Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(authError && (!authError.status || authError.status >= 500) ? 503 : 401).json({
        status: 'error',
        message: 'Phiên đăng nhập đã hết hạn hoặc mã xác thực không hợp lệ. Vui lòng đăng nhập lại.',
      });
    }

    const authUserId = authData.user.id;

    // Fetch user details from public.users using supabaseAdmin (bypasses RLS)
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, username, role, branch_id, is_active, must_change_password, password_reset_id')
      .eq('id', authUserId)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      return res.status(503).json({ status: 'error', message: 'Không thể đọc phân quyền tài khoản. Vui lòng thử lại.' });
    }
    if (!dbUser) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản chưa được cấu hình vai trò nghiệp vụ trong hệ thống. Vui lòng liên hệ quản trị viên.',
      });
    }

    if (dbUser.is_active !== true || !['NV', 'QL', 'GS'].includes(dbUser.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản của bạn đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên.'
      });
    }

    if (typeof dbUser.must_change_password !== 'boolean') {
      return res.status(503).json({ status: 'error', message: 'Cấu hình bảo mật tài khoản chưa sẵn sàng.' });
    }

    const reset = authData.user.app_metadata?.jollishift_password_reset;
    if (dbUser.password_reset_id && reset?.id === dbUser.password_reset_id && typeof reset.issued_at === 'number' && !passwordLoginAfter(token, reset.issued_at)) {
      return res.status(401).json({ status: 'error', code: 'FRESH_LOGIN_REQUIRED', message: 'Vui lòng đăng xuất và đăng nhập lại bằng mật khẩu hiện tại được cấp hoặc mật khẩu mới đã lưu.' });
    }

    // Optional: Fetch branch name if assigned
    let branchName: string | null = null;
    if (dbUser.branch_id) {
      const { data: branchData } = await supabaseAdmin
        .from('branches')
        .select('name')
        .eq('id', dbUser.branch_id)
        .single();
      branchName = branchData?.name || null;
    }

    // Optional: Fetch employee info if user has role NV
    let employeeInfo: EmployeeInfo | null = null;
    if (dbUser.role === 'NV') {
      const { data: empData } = await supabaseAdmin
        .from('employees')
        .select('id, full_name, skill_level, department_id, phone, departments:department_id(name)')
        .eq('user_id', authUserId)
        .maybeSingle();

      if (empData) {
        const dept = empData.departments as any;
        employeeInfo = {
          id: empData.id,
          full_name: empData.full_name,
          skill_level: empData.skill_level,
          department_id: empData.department_id,
          department_name: dept?.name || undefined,
          phone: empData.phone || undefined,
        };
      }
    }

    const authenticatedUser: AuthenticatedUser = {
      id: dbUser.id,
      email: authData.user.email,
      username: dbUser.username,
      role: dbUser.role as UserRole,
      branch_id: dbUser.branch_id,
      branch_name: branchName,
      is_active: dbUser.is_active,
      must_change_password: dbUser.must_change_password,
      password_reset_id: dbUser.password_reset_id,
      employee: employeeInfo,
    };

    req.user = authenticatedUser;
    next();
  } catch (err: any) {
    console.error('[Auth] Request failed.');
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi máy chủ khi xác thực. Vui lòng thử lại.'
    });
  }
}

export function requirePasswordChanged(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập.' });
  if (req.user.must_change_password !== false) return res.status(403).json({
    status: 'error', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Vui lòng đổi mật khẩu trước khi tiếp tục.',
  });
  next();
}

// Default for all business routes. Auth lifecycle routes explicitly use authenticateSession.
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  return authenticateSession(req, res, () => { requirePasswordChanged(req, res, next); });
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Yêu cầu chưa được xác thực danh tính.'
      });
    }

    if (req.user.must_change_password !== false) {
      return res.status(403).json({ status: 'error', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Vui lòng đổi mật khẩu trước khi tiếp tục.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: `Truy cập bị từ chối: Vai trò [${req.user.role}] không có quyền thực hiện thao tác này. Quyền yêu cầu: [${allowedRoles.join(', ')}].`,
        userRole: req.user.role,
        requiredRoles: allowedRoles
      });
    }

    next();
  };
}
