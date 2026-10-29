import { Router, Request, Response } from 'express';
import { supabaseAdmin, createAuthClient } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { UserRole } from '../types/auth.types.js';

const router = Router();

// 1. POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
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
      return res.status(401).json({
        status: 'error',
        message: 'Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.',
        details: authError?.message
      });
    }

    const authUserId = authData.user.id;

    // Check user in public.users using supabaseAdmin (bypasses RLS with service_role)
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, username, role, branch_id, is_active')
      .eq('id', authUserId)
      .single();

    if (userError || !dbUser) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản tồn tại trong hệ thống xác thực nhưng chưa được phân quyền trong cơ sở dữ liệu. Vui lòng liên hệ quản trị viên.',
        details: userError?.message
      });
    }

    if (!dbUser.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc tạm khóa. Vui lòng liên hệ quản lý.'
      });
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
        employee: employeeInfo
      }
    });
  } catch (err: any) {
    console.error('[Login Route Error]:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi máy chủ trong quá trình đăng nhập: ' + (err.message || 'Lỗi không xác định')
    });
  }
});

// 2. GET /api/auth/me (Protected - current authenticated user info)
router.get('/me', authenticate, (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    user: req.user
  });
});

// 3. POST /api/auth/logout (Protected)
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Đăng xuất thành công.'
  });
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
