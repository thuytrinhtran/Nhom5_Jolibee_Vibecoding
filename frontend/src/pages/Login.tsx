import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/auth';
import { Mail, Lock, Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import logoImg from '../assets/jollibee-logo.jpg';
import bannerImg from '../assets/jollibee-banner.png';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, user, error } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user) {
      if (user.must_change_password) navigate('/change-password', { replace: true });
      else redirectToDashboard(user.role);
    }
  }, [user]);

  const redirectToDashboard = (role: UserRole) => {
    const from = (location.state as any)?.from?.pathname;
    const dashboard = { NV: '/employee', QL: '/manager', GS: '/supervisor' }[role];
    if (from && (from === dashboard || from.startsWith(`${dashboard}/`))) {
      navigate(from, { replace: true });
      return;
    }

    if (role === 'NV') navigate('/employee', { replace: true });
    else if (role === 'QL') navigate('/manager', { replace: true });
    else if (role === 'GS') navigate('/supervisor', { replace: true });
    else navigate('/', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password) {
      setLocalError('Vui lòng nhập đầy đủ Email và Mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      const loggedInUser = await login(email.trim(), password);
      if (loggedInUser.must_change_password) navigate('/change-password', { replace: true });
      else redirectToDashboard(loggedInUser.role);
    } catch (err: any) {
      setLocalError(err.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      backgroundColor: '#ffffff',
    }}>
      {/* Left Column: Brand Hero Area (Desktop only, responsive) */}
      <div style={{
        flex: '1 1 50%',
        backgroundColor: '#D9252A',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '3rem 2.5rem',
        color: '#ffffff',
        overflow: 'hidden',
      }} className="login-brand-col">
        {/* Decorative background overlay */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'radial-gradient(circle at 20% 20%, rgba(253, 184, 19, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(0, 0, 0, 0.25) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: '560px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          {/* Brand Banner Image (Provided Asset - Preserved ratio) */}
          <div style={{
            width: '100%',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
            backgroundColor: '#B91C1C',
            marginBottom: '2rem',
            border: '2px solid rgba(255, 255, 255, 0.15)',
          }}>
            <img
              src={bannerImg}
              alt="Jollibee - Gà Giòn Vui Vẻ"
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>

          {/* Core Brand Message */}
          <h2 style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            lineHeight: 1.25,
            marginBottom: '0.75rem',
            color: '#ffffff',
            letterSpacing: '-0.02em',
          }}>
            Vận hành chính xác. Phân công tối ưu.
          </h2>
          <p style={{
            fontSize: '0.95rem',
            color: '#fee2e2',
            maxWidth: '440px',
            lineHeight: 1.6,
          }}>
            Giải pháp số hóa quy trình đăng ký, cân đối nguồn lực và xếp lịch làm việc dành riêng cho đội ngũ Jollibee.
          </p>
        </div>
      </div>

      {/* Right Column: Clean, Modern Form Area */}
      <div style={{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2.5rem 2rem',
        backgroundColor: '#ffffff',
      }}>
        <div style={{
          maxWidth: '420px',
          width: '100%',
        }}>
          {/* Logo & System Brand */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.25rem' }}>
              <img
                src={logoImg}
                alt="Jollibee Logo"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '12px',
                  objectFit: 'contain',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                }}
              />
              <div>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#D9252A',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  Hệ thống nội bộ
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                  <h1 style={{
                    fontSize: '1.875rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '-0.03em',
                    lineHeight: 1.1,
                  }}>
                    Jolli<span style={{ color: '#D9252A' }}>Shift</span>
                  </h1>
                </div>
              </div>
            </div>

            <p style={{
              fontSize: '0.925rem',
              color: '#475569',
              fontWeight: 500,
            }}>
              Hệ thống quản lý lịch làm việc
            </p>
          </div>

          {/* Internal Access Notice */}
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            fontSize: '0.8125rem',
            color: '#64748b',
            marginBottom: '1.5rem',
            lineHeight: 1.5,
          }}>
            Hệ thống quản lý nội bộ. Vui lòng đăng nhập bằng tài khoản được cấp bởi Quản trị viên.
          </div>

          {/* Error Message */}
          {(localError || error) && (
            <div role="alert" style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
              padding: '0.875rem 1rem',
              borderRadius: '10px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '0.875rem',
              marginBottom: '1.5rem',
              lineHeight: 1.4,
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{localError || error}</div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit}>
            {/* Email Field */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label htmlFor="login-email" style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}>
                Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  size={18}
                  color="#94a3b8"
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />
                <input
                  id="login-email"
                  autoComplete="username"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@jollibee.com.vn"
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0.7rem 1rem 0.7rem 2.6rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9375rem',
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#D9252A';
                    e.target.style.boxShadow = '0 0 0 3px rgba(217, 37, 42, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#cbd5e1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password Field */}
            <div style={{ marginBottom: '1.75rem' }}>
              <label htmlFor="login-password" style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}>
                Mật khẩu
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={18}
                  color="#94a3b8"
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />
                <input
                  id="login-password"
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  required
                  style={{
                    width: '100%',
                    padding: '0.7rem 2.75rem 0.7rem 2.6rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9375rem',
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#D9252A';
                    e.target.style.boxShadow = '0 0 0 3px rgba(217, 37, 42, 0.12)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#cbd5e1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '0.75rem 1.25rem',
                fontSize: '0.9375rem',
                fontWeight: 700,
                borderRadius: '10px',
                height: '46px',
              }}
            >
              {submitting ? (
                <span>Đang đăng nhập...</span>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>Đăng nhập</span>
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <div style={{
            marginTop: '2.5rem',
            textAlign: 'center',
            fontSize: '0.8125rem',
            color: '#94a3b8',
          }}>
            © 2026 Jollibee Vietnam. Bảo lưu mọi quyền.
          </div>
        </div>
      </div>

      {/* Responsive Style */}
      <style>{`
        @media (max-width: 900px) {
          .login-brand-col {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
