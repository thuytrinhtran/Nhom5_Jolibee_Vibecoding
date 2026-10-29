import { Router } from 'express';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { authenticateSession } from '../middleware/auth.middleware.js';
import { createAuthClient, supabaseAdmin, userAuthRequest } from '../config/supabase.js';

const router = Router();
export function passwordPolicy() {
  const minLength = Number(process.env.PASSWORD_MIN_LENGTH || 12);
  const required = (process.env.PASSWORD_REQUIRED_GROUPS || 'lower,upper,digit,symbol').split(',').filter(Boolean);
  if (!Number.isInteger(minLength) || minLength < 6 || minLength > 128 || required.some(g => !['lower','upper','digit','symbol'].includes(g))) throw new Error('Invalid password policy');
  return { minLength, maxLength: 128, required };
}
export function validPassword(password: string) {
  const p = passwordPolicy();
  const groups: Record<string, RegExp> = { lower: /[a-z]/, upper: /[A-Z]/, digit: /[0-9]/, symbol: /[^a-zA-Z0-9\s]/ };
  return password.length >= p.minLength && password.length <= p.maxLength && p.required.every(g => groups[g].test(password));
}
export function matchesTemporary(password: string, marker: { salt: string; hash: string }) {
  const expected = Buffer.from(marker.hash, 'hex');
  const actual = scryptSync(password, marker.salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
router.get('/password-policy', authenticateSession, (_req, res) => {
  try { return res.json({ status: 'ok', policy: passwordPolicy() }); }
  catch { return res.status(503).json({ status: 'error', message: 'Cấu hình mật khẩu chưa sẵn sàng.' }); }
});
router.post('/reauthenticate', authenticateSession, async (req, res) => {
  try {
    const result = await userAuthRequest(req.headers.authorization!.slice(7), '/reauthenticate');
    if (!result.ok) return res.status(result.status === 429 ? 429 : 400).json({ status: 'error', message: 'Chưa gửi được mã xác thực. Kiểm tra email nhận mã hoặc đăng nhập lại.' });
    return res.json({ status: 'ok', message: 'Mã xác thực đã được gửi theo cấu hình tài khoản.' });
  } catch { return res.status(503).json({ status: 'error', message: 'Dịch vụ xác thực tạm thời không khả dụng.' }); }
});
router.post('/change-password', authenticateSession, async (req, res) => {
  const { password, confirmation, nonce } = req.body || {};
  try {
    if (typeof password !== 'string' || typeof confirmation !== 'string' || password !== confirmation) return res.status(400).json({ status: 'error', message: 'Hai mật khẩu phải trùng nhau.' });
    if (!validPassword(password)) return res.status(400).json({ status: 'error', message: 'Mật khẩu chưa đáp ứng độ dài hoặc nhóm ký tự được yêu cầu.' });
    if (nonce !== undefined && (typeof nonce !== 'string' || nonce.length > 256)) return res.status(400).json({ status: 'error', message: 'Mã xác thực không hợp lệ.' });
    const user = req.user!;
    if (!user.must_change_password) return res.status(409).json({ status: 'error', message: 'Tài khoản không có yêu cầu đổi mật khẩu. Vui lòng tải lại trang.' });
    const token = req.headers.authorization!.slice(7);
    const { data: identity, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !identity.user) return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập lại.' });
    const marker = identity.user.app_metadata?.jollishift_password_reset;
    if (!user.password_reset_id || marker?.id !== user.password_reset_id || typeof marker.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(marker.hash) || typeof marker.salt !== 'string' || marker.salt.length < 8 || marker.salt.length > 128 || !Number.isInteger(marker.issued_at)) return res.status(409).json({ status: 'error', code: 'RESET_NOT_READY', message: 'Việc cấp mật khẩu chưa hoàn tất. Vui lòng liên hệ quản trị viên.' });
    if (matchesTemporary(password, marker)) return res.status(400).json({ status: 'error', message: 'Mật khẩu mới phải khác mật khẩu tạm thời.' });
    const result = await userAuthRequest(token, '/user', { password, ...(nonce ? { nonce } : {}) });
    if (!result.ok) {
      const code = result.data.code || result.data.error_code;
      if (code === 'same_password') {
        // Safe recovery if Auth succeeded earlier but the public-state update failed.
        // Verify the current NEW password; the temporary-password fingerprint was rejected above.
        const proof = await createAuthClient().auth.signInWithPassword({ email: identity.user.email!, password });
        if (proof.error || proof.data.user?.id !== user.id || !proof.data.session) return res.status(400).json({ status: 'error', message: 'Chưa xác nhận được mật khẩu mới. Vui lòng đăng nhập lại.' });
        await supabaseAdmin.auth.admin.signOut(proof.data.session.access_token, 'local');
      } else {
        const reauth = ['reauthentication_needed','reauthentication_not_valid','reauthentication_required'].includes(code);
        return res.status(result.status === 429 ? 429 : 400).json({ status: 'error', code: reauth ? 'REAUTHENTICATION_REQUIRED' : code === 'insufficient_aal' ? 'MFA_REQUIRED' : 'PASSWORD_REJECTED', message: reauth ? 'Cần xác thực lại. Hãy nhận mã xác thực hoặc đăng nhập lại rồi thử tiếp.' : code === 'insufficient_aal' ? 'Tài khoản yêu cầu xác thực hai bước. Vui lòng hoàn tất xác thực trước.' : 'Supabase chưa chấp nhận mật khẩu mới. Hãy chọn mật khẩu mạnh hơn và kiểm tra mã xác thực nếu có.' });
      }
    }
    const { data: updated, error: updateError } = await supabaseAdmin.from('users')
      .update({ must_change_password: false }).eq('id', user.id).eq('password_reset_id', user.password_reset_id)
      .eq('must_change_password', true).select('id').maybeSingle();
    if (updateError || !updated) return res.status(503).json({ status: 'error', code: 'PASSWORD_STATE_PENDING', message: 'Mật khẩu mới đã được lưu nhưng chưa hoàn tất xác nhận. Hãy thử lại với cùng mật khẩu mới; nếu cần đăng nhập lại, dùng mật khẩu mới.' });
    return res.json({ status: 'ok', user: { ...user, must_change_password: false } });
  } catch { return res.status(503).json({ status: 'error', message: 'Chưa hoàn tất đổi mật khẩu. Hãy thử lại; nếu mật khẩu đã đổi, dùng mật khẩu mới để đăng nhập.' }); }
});
export default router;
