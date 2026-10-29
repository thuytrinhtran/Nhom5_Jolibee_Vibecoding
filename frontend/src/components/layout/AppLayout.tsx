import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  Calendar, 
  Clock, 
  ArrowLeftRight, 
  AlertTriangle, 
  LayoutDashboard, 
  Users, 
  CalendarDays, 
  CheckSquare, 
  Globe, 
  FileText, 
  LogOut, 
  ChevronLeft, 
  ChevronRight, 
  Menu, 
  X, 
  Bell, 
  Building, 
  UserCircle 
} from 'lucide-react';
import logoImg from '../../assets/jollibee-logo.jpg';

interface MenuItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!user) return null;

  // Define role-specific navigation menus
  const getNavItems = (): MenuItem[] => {
    switch (user.role) {
      case 'NV':
        return [
          { label: 'Tổng quan', path: '/employee', icon: <LayoutDashboard size={20} /> },
          { label: 'Đăng ký ca làm', path: '/employee/register', icon: <Calendar size={20} /> },
          { label: 'Lịch cá nhân', path: '/employee/schedule', icon: <Clock size={20} /> },
          { label: 'Đổi ca & Lời mời', path: '/employee/shift-requests', icon: <ArrowLeftRight size={20} /> },
          { label: 'Báo sự cố', path: '/employee/incidents', icon: <AlertTriangle size={20} /> },
        ];
      case 'QL':
        return [
          { label: 'Tổng quan', path: '/manager', icon: <LayoutDashboard size={20} /> },
          { label: 'Nhu cầu nhân sự', path: '/manager/demand', icon: <Users size={20} /> },
          { label: 'Lập & Điều chỉnh lịch', path: '/manager/schedule', icon: <CalendarDays size={20} /> },
          { label: 'Duyệt đổi ca & Sự cố', path: '/manager/shift-requests', icon: <ArrowLeftRight size={20} /> },
          { label: 'Danh sách nhân sự', path: '/manager/staff', icon: <Users size={20} /> },
        ];
      case 'GS':
        return [
          { label: 'Tổng quan', path: '/supervisor', icon: <LayoutDashboard size={20} /> },
          { label: 'Phê duyệt lịch làm', path: '/supervisor/approvals', icon: <CheckSquare size={20} /> },
          { label: 'Viện trợ liên chi nhánh', path: '/supervisor/support', icon: <Globe size={20} /> },
          { label: 'Báo cáo & Lịch sử', path: '/supervisor/reports', icon: <FileText size={20} /> },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  const roleNameMap: Record<string, { label: string; badgeClass: string }> = {
    NV: { label: 'Nhân viên', badgeClass: 'badge-green' },
    QL: { label: 'Quản lý ca', badgeClass: 'badge-yellow' },
    GS: { label: 'Giám sát khu vực', badgeClass: 'badge-red' },
  };

  const roleMeta = roleNameMap[user.role] || { label: user.role, badgeClass: 'badge-slate' };

  // Find current page title
  const currentItem = navItems.find(item => item.path === location.pathname);
  const pageTitle = currentItem ? currentItem.label : 'JolliShift';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-page)' }}>
      {/* 1. Left Sidebar (Collapsible) */}
      <aside
        style={{
          width: collapsed ? '72px' : '260px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          zIndex: 40,
          flexShrink: 0,
        }}
        className={mobileMenuOpen ? 'sidebar-mobile-open' : 'sidebar-desktop'}
      >
        {/* Brand header */}
        <div style={{
          height: '68px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: collapsed ? '0 1rem' : '0 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          <img
            src={logoImg}
            alt="Jollibee Logo"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
          {!collapsed && (
            <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                Jolli<span style={{ color: 'var(--primary)' }}>Shift</span>
              </span>
            </div>
          )}
        </div>

        {/* Role identification badge */}
        {!collapsed && (
          <div style={{ padding: '0.875rem 1.25rem 0.5rem 1.25rem' }}>
            <span className={`badge ${roleMeta.badgeClass}`} style={{ width: '100%', justifyContent: 'center' }}>
              {roleMeta.label}
            </span>
          </div>
        )}

        {/* Navigation list */}
        <nav style={{ flex: 1, padding: '0.75rem 0.5rem', overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none' }}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path} style={{ marginBottom: '0.25rem' }}>
                  <NavLink
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: collapsed ? '0.75rem 0' : '0.625rem 0.875rem',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderRadius: 'var(--radius-md)',
                      color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'var(--primary-subtle)' : 'transparent',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: '0.875rem',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                      borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                    }}
                    title={collapsed ? item.label : undefined}
                    onMouseOver={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = '#f1f5f9';
                        e.currentTarget.style.color = '#0f172a';
                      }
                    }}
                    onMouseOut={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                    {!collapsed && (
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.label}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse toggle at bottom (Desktop) */}
        <div style={{
          padding: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="btn btn-outline btn-sm"
            style={{ width: collapsed ? '38px' : 'auto', padding: collapsed ? '0.5rem 0' : '0.375rem 0.75rem' }}
            title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          >
            {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /> <span>Thu gọn</span></>}
          </button>
        </div>
      </aside>

      {/* 2. Main Content & Header */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Header */}
        <header style={{
          height: '68px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1.5rem',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}>
          {/* Left: Mobile hamburger & Page Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="btn btn-outline btn-sm mobile-menu-btn"
              style={{ display: 'none' }}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {pageTitle}
            </h2>
          </div>

          {/* Right: Store, Notifications & User Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Branch pill */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              backgroundColor: '#f8fafc',
              padding: '0.35rem 0.75rem',
              borderRadius: '9999px',
              border: '1px solid var(--border-subtle)',
            }} className="header-branch-pill">
              <Building size={14} color="var(--primary)" />
              <span style={{ fontWeight: 600 }}>{user.branch_name || 'Chi nhánh Jollibee'}</span>
            </div>

            {/* Notification icon button */}
            <button
              className="btn btn-outline btn-sm"
              style={{ padding: '0.5rem', borderRadius: '50%', width: '36px', height: '36px' }}
              title="Thông báo"
            >
              <Bell size={17} />
            </button>

            {/* User profile dropdown / pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: 'var(--primary-subtle)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.875rem',
                border: '1px solid var(--primary-border)',
              }}>
                {user.employee?.full_name ? user.employee.full_name.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }} className="header-user-text">
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {user.employee?.full_name || user.username}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {roleMeta.label}
                </span>
              </div>
            </div>

            {/* Logout button */}
            <button
              onClick={logout}
              className="btn btn-outline btn-sm"
              style={{ color: '#dc2626', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}
              title="Đăng xuất khỏi hệ thống"
            >
              <LogOut size={16} />
              <span className="logout-text">Đăng xuất</span>
            </button>
          </div>
        </header>

        {/* Page Content Container */}
        <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
          {children}
        </main>
      </div>

      {/* Responsive mobile styles */}
      <style>{`
        @media (max-width: 768px) {
          .mobile-menu-btn {
            display: inline-flex !important;
          }
          .sidebar-desktop {
            display: none !important;
          }
          .sidebar-mobile-open {
            display: flex !important;
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            width: 260px !important;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          }
          .header-branch-pill, .header-user-text, .logout-text {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
