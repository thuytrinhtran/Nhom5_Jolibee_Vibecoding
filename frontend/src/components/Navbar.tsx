import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, User, Building, Shield } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  const roleLabelMap: Record<string, { label: string; color: string; bg: string }> = {
    NV: { label: 'Nhân viên', color: '#15803d', bg: '#dcfce7' },
    QL: { label: 'Quản lý ca', color: '#b45309', bg: '#fef3c7' },
    GS: { label: 'Giám sát khu vực', color: '#b91c1c', bg: '#fee2e2' },
  };

  const roleConfig = roleLabelMap[user.role] || { label: user.role, color: '#334155', bg: '#f1f5f9' };

  return (
    <nav style={{
      backgroundColor: '#ffffff',
      borderBottom: '2px solid #D9252A',
      boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '0.75rem 1.5rem',
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.8rem' }}>🐝</span>
          <div>
            <h1 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#D9252A', lineHeight: 1.2 }}>
              JOLLIBEE SHIFT SYSTEM
            </h1>
            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>
              MIS3047 – Quản lý Quy trình Kinh doanh (Nhóm 5)
            </p>
          </div>
        </div>

        {/* User Status & Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Role Badge */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.75rem',
            borderRadius: '9999px',
            fontSize: '0.8rem',
            fontWeight: 700,
            color: roleConfig.color,
            backgroundColor: roleConfig.bg,
            border: `1px solid ${roleConfig.color}40`,
          }}>
            <Shield size={14} />
            {roleConfig.label}
          </span>

          {/* User profile info */}
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <User size={14} color="#64748b" />
              {user.employee?.full_name || user.username}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Building size={12} />
              {user.branch_name || 'Chi nhánh Jollibee'}
            </span>
          </div>

          {/* Logout Button */}
          <button
            onClick={logout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.85rem',
              backgroundColor: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#fee2e2';
              e.currentTarget.style.color = '#b91c1c';
              e.currentTarget.style.borderColor = '#fca5a5';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9';
              e.currentTarget.style.color = '#334155';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
          >
            <LogOut size={15} />
            Đăng xuất
          </button>
        </div>
      </div>
    </nav>
  );
};
