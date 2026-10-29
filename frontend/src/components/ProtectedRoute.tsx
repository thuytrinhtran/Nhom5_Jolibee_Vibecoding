import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/auth';
import { ShieldAlert, ArrowLeft, RefreshCw } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  allowPasswordChange?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, allowPasswordChange = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        gap: '1rem',
        color: '#64748b'
      }}>
        <RefreshCw size={32} className="spin" color="#D9252A" />
        <p style={{ fontWeight: 600 }}>Đang xác thực thông tin tài khoản...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.must_change_password !== false && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const roleNameMap: Record<UserRole, string> = {
      NV: 'Nhân viên',
      QL: 'Quản lý ca',
      GS: 'Giám sát khu vực',
    };

    const targetRouteMap: Record<UserRole, string> = {
      NV: '/employee',
      QL: '/manager',
      GS: '/supervisor',
    };

    return (
      <div style={{
        maxWidth: '600px',
        margin: '4rem auto',
        padding: '2rem',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #fee2e2',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        textAlign: 'center'
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: '#fee2e2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem auto'
        }}>
          <ShieldAlert size={36} color="#dc2626" />
        </div>

        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#991b1b', marginBottom: '0.75rem' }}>
          403 – Truy cập bị từ chối
        </h2>

        <p style={{ color: '#475569', marginBottom: '1rem', fontSize: '0.95rem' }}>
          Tài khoản của bạn đang có vai trò <strong>{roleNameMap[user.role]} ({user.role})</strong>.
          Bạn không có quyền truy cập vào phân hệ này.
        </p>

        <div style={{
          backgroundColor: '#f8fafc',
          padding: '0.75rem',
          borderRadius: '8px',
          fontSize: '0.85rem',
          color: '#64748b',
          marginBottom: '1.75rem',
          border: '1px solid #e2e8f0'
        }}>
          Vai trò được phép truy cập trang này: <strong>{allowedRoles.map(r => roleNameMap[r] || r).join(', ')}</strong>
        </div>

        <button
          onClick={() => navigate(targetRouteMap[user.role] || '/login')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.65rem 1.25rem',
            backgroundColor: '#D9252A',
            color: '#ffffff',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={16} />
          Quay về Phân hệ {roleNameMap[user.role]} của bạn
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
