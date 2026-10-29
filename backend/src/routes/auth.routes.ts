import { Router, Request, Response } from 'express';
import { supabaseAdmin, createAuthClient } from '../config/supabase.js';
import { authenticate, authenticateSession, requireRole } from '../middleware/auth.middleware.js';
import passwordRoutes from './password.routes.js';
import { UserRole } from '../types/auth.types.js';

const router = Router();
router.use(passwordRoutes);

// 1. POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Vui lòng nhập đầy đủ Email và Mật khẩu.'
      });
    }

    // Attempt sign-in with an isolated client so service_role credentials on supabaseAdmin are preserved
    const authClient = createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (authError || !authData.user || !authData.session) {
      return res.status(authError && (!authError.status || authError.status >= 500) ? 503 : 401).json({
        status: 'error',
        message: authError && (!authError.status || authError.status >= 500)
          ? 'Dịch vụ xác thực tạm thời không khả dụng.'
          : 'Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.',
      });
    }

    const authUserId = authData.user.id;

    // Check user in public.users using supabaseAdmin (bypasses RLS with service_role)
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, username, role, branch_id, is_active, must_change_password')
      .eq('id', authUserId)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      return res.status(503).json({ status: 'error', message: 'Không thể đọc phân quyền tài khoản. Vui lòng thử lại.' });
    }
    if (!dbUser) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản tồn tại trong hệ thống xác thực nhưng chưa được phân quyền trong cơ sở dữ liệu. Vui lòng liên hệ quản trị viên.',
      });
    }

    if (dbUser.is_active !== true || !['NV', 'QL', 'GS'].includes(dbUser.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc tạm khóa. Vui lòng liên hệ quản lý.'
      });
    }

    if (typeof dbUser.must_change_password !== 'boolean') {
      return res.status(503).json({ status: 'error', message: 'Cấu hình bảo mật tài khoản chưa sẵn sàng.' });
    }

    // Branch info
    let branchName: string | null = null;
    if (dbUser.branch_id) {
      const { data: bData } = await supabaseAdmin
        .from('branches')
        .select('name')
        .eq('id', dbUser.branch_id)
        .single();
      branchName = bData?.name || null;
    }

    // Employee info if role is NV
    let employeeInfo = null;
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

    return res.status(200).json({
      status: 'ok',
      message: 'Đăng nhập thành công',
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_at: authData.session.expires_at,
      user: {
        id: dbUser.id,
        email: authData.user.email,
        username: dbUser.username,
        role: dbUser.role as UserRole,
        branch_id: dbUser.branch_id,
        branch_name: branchName,
        is_active: dbUser.is_active,
        must_change_password: dbUser.must_change_password,
        employee: employeeInfo
      }
    });
  } catch (err: any) {
    console.error('[Auth] Request failed.');
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi máy chủ khi xác thực. Vui lòng thử lại.'
    });
  }
});

// 2. GET /api/auth/me (Protected - current authenticated user info)
router.get('/me', authenticateSession, (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    user: req.user
  });
});

// Refresh rotates the Supabase refresh token, then rechecks public.users via authenticate.
router.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== 'string' || !refresh_token.trim()) {
    return res.status(400).json({ status: 'error', message: 'Thiếu thông tin khôi phục phiên.' });
  }
  try {
    const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token });
    if (error || !data.session) {
      return res.status(error && error.status && error.status >= 500 ? 503 : 401).json({ status: 'error', message: 'Không thể khôi phục phiên. Vui lòng thử lại hoặc đăng nhập lại.' });
    }
    const session = data.session;
    req.headers.authorization = `Bearer ${session.access_token}`;
    return authenticateSession(req, res, () => {
      res.json({ status: 'ok', access_token: session.access_token, refresh_token: session.refresh_token,
        expires_at: session.expires_at, user: req.user });
    });
  } catch {
    return res.status(503).json({ status: 'error', message: 'Dịch vụ xác thực tạm thời không khả dụng.' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  const match = req.headers.authorization?.match(/^Bearer ([^ ]+)$/);
  if (!match) return res.status(401).json({ status: 'error', message: 'Thiếu mã xác thực.' });
  try {
    const { error } = await supabaseAdmin.auth.admin.signOut(match[1], 'local');
    if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) {
      return res.status(503).json({ status: 'error', message: 'Chưa thể thu hồi phiên trên máy chủ. Phiên trên trình duyệt sẽ được xóa.' });
    }
    return res.json({ status: 'ok', message: 'Đăng xuất thành công.' });
  } catch {
    return res.status(503).json({ status: 'error', message: 'Chưa thể thu hồi phiên trên máy chủ.' });
  }
});

// 4. Role-based test endpoints to verify Backend authorization
router.get('/test/employee-only', authenticate, requireRole(['NV']), (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Chào mừng Nhân viên (NV). Bạn đã truy cập tài nguyên được phân quyền thành công.',
    user: req.user
  });
});

router.get('/test/manager-only', authenticate, requireRole(['QL']), (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Chào mừng Quản lý ca (QL). Bạn đã truy cập tài nguyên được phân quyền thành công.',
    user: req.user
  });
});

router.get('/test/supervisor-only', authenticate, requireRole(['GS']), (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Chào mừng Giám sát khu vực (GS). Bạn đã truy cập tài nguyên được phân quyền thành công.',
    user: req.user
  });
});

export default router;
