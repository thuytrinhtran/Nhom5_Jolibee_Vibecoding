import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, LogOut, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError, authService } from '../services/auth.service';
import logo from '../assets/jollibee-logo.jpg';

export const ChangePassword = () => {
  const { user, changePassword, logout, refreshUser } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [policy, setPolicy] = useState<{ minLength: number; maxLength: number; required: string[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  useEffect(() => {
    let active = true;
    authService.getPasswordPolicy().then(p => { if (active) setPolicy(p); }).catch(() => { if (active) setError('Chưa tải được yêu cầu mật khẩu. Vui lòng tải lại trang.'); });
    return () => { active = false; };
  }, []);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to="/" replace />;
  const groupNames: Record<string, string> = { lower: 'chữ thường', upper: 'chữ hoa', digit: 'chữ số', symbol: 'ký tự đặc biệt' };
  const rules: Record<string, RegExp> = { lower: /[a-z]/, upper: /[A-Z]/, digit: /[0-9]/, symbol: /[^a-zA-Z0-9\s]/ };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!policy) { setError('Chưa tải được yêu cầu mật khẩu.'); return; }
    if (password !== confirmation) { setError('Hai mật khẩu chưa trùng nhau.'); return; }
    if (password.length < policy.minLength || password.length > policy.maxLength || !policy.required.every(g => rules[g]?.test(password))) { setError('Mật khẩu chưa đáp ứng các yêu cầu bên dưới.'); return; }
    setBusy(true);
    try { await changePassword(password, confirmation, nonce || undefined); setPassword(''); setConfirmation(''); setNonce(''); }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Chưa đổi được mật khẩu. Vui lòng thử lại.');
      if (err instanceof ApiError && err.code === 'REAUTHENTICATION_REQUIRED') setNeedsReauth(true);
      if (err instanceof ApiError && err.status === 409 && err.code !== 'RESET_NOT_READY') await refreshUser();
    } finally { setBusy(false); }
  };
  const sendNonce = async () => {
    setBusy(true); setError('');
    try { await authService.reauthenticate(); setNotice('Mã xác thực đã được gửi. Vui lòng kiểm tra email hoặc điện thoại nhận mã.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Chưa gửi được mã xác thực.'); }
    finally { setBusy(false); }
  };
  return (
    <main className="password-change-page">
      <section className="password-change-card" aria-labelledby="password-title">
        <div className="password-change-brand"><img src={logo} width={40} height={40} alt="Jollibee" /><strong>Jolli<span>Shift</span></strong></div>
        <span className="password-change-icon"><LockKeyhole size={24} aria-hidden="true" /></span>
        <h1 id="password-title">Đổi mật khẩu</h1>
        <p className="password-change-intro">Đây là lần đầu bạn đăng nhập. Vui lòng tạo mật khẩu mới để bảo vệ tài khoản.</p>
        {error && <div className="password-change-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
        {notice && <p role="status" className="password-change-notice">{notice}</p>}
        <form onSubmit={submit}>
          <label htmlFor="new-password">Mật khẩu mới</label>
          <div className="password-change-input"><input id="new-password" type={visible ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby="password-rules" /><button type="button" aria-label={visible ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          <p id="password-rules" className="password-change-rules">{policy ? `Từ ${policy.minLength} đến ${policy.maxLength} ký tự${policy.required.length ? `, gồm ${policy.required.map(g => groupNames[g]).join(', ')}` : ''}. Không sử dụng lại mật khẩu tạm thời.` : 'Đang tải yêu cầu mật khẩu…'}</p>
          <label htmlFor="confirm-password">Xác nhận mật khẩu mới</label>
          <div className="password-change-input"><input id="confirm-password" type={confirmVisible ? 'text' : 'password'} autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /><button type="button" aria-label={confirmVisible ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'} aria-pressed={confirmVisible} onClick={() => setConfirmVisible(!confirmVisible)}>{confirmVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {needsReauth && <div className="password-change-reauth"><label htmlFor="reauth-nonce">Mã xác thực</label><input id="reauth-nonce" autoComplete="one-time-code" value={nonce} onChange={e => setNonce(e.target.value)} maxLength={256} disabled={busy} /><button type="button" className="btn btn-outline" onClick={() => void sendNonce()} disabled={busy}>Gửi mã xác thực</button><p>Nếu không nhận được mã, hãy đăng xuất và đăng nhập lại hoặc liên hệ quản trị viên.</p></div>}
          <button className="btn btn-primary password-change-submit" disabled={busy || !policy}>{busy ? 'Đang xử lý…' : 'Lưu mật khẩu'}</button>
        </form>
        <button className="password-change-logout" onClick={() => { setPassword(''); setConfirmation(''); setNonce(''); void logout(); }} disabled={busy}><LogOut size={16} aria-hidden="true" />Đăng xuất</button>
      </section>
    </main>
  );
};
