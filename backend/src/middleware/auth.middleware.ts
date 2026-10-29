import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AuthenticatedUser, UserRole, EmployeeInfo } from '../types/auth.types.js';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
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
      return res.status(401).json({
        status: 'error',
        message: 'Phiên đăng nhập đã hết hạn hoặc mã xác thực không hợp lệ. Vui lòng đăng nhập lại.',
        details: authError?.message
      });
    }

    const authUserId = authData.user.id;

    // Fetch user details from public.users using supabaseAdmin (bypasses RLS)
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, username, role, branch_id, is_active')
      .eq('id', authUserId)
      .single();

    if (userError || !dbUser) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản chưa được cấu hình vai trò nghiệp vụ trong hệ thống. Vui lòng liên hệ quản trị viên.',
        details: userError?.message
      });
    }

    if (!dbUser.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản của bạn đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên.'
      });
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
      employee: employeeInfo,
    };

    req.user = authenticatedUser;
    next();
  } catch (err: any) {
    console.error('[Auth Middleware Error]:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi xác thực hệ thống: ' + (err.message || 'Lỗi không xác định')
    });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Yêu cầu chưa được xác thực danh tính.'
      });
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
