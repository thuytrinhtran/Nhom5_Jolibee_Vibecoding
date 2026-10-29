import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bell, Building2, ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { dashboardConfig } from '../../dashboard.config';
import logoImg from '../../assets/jollibee-logo.jpg';

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const notifications = useRef<HTMLDivElement>(null);

  useEffect(() => { setMobileOpen(false); setNotificationsOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key === 'Tab') {
        const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a, button') || []).filter(el => el.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const media = window.matchMedia('(max-width: 768px)');
    const onResize = () => { if (!media.matches) setMobileOpen(false); };
    media.addEventListener('change', onResize);
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; media.removeEventListener('change', onResize); document.removeEventListener('keydown', onKey); menuButton.current?.focus(); };
  }, [mobileOpen]);
  useEffect(() => {
    if (!notificationsOpen) return;
    const close = (event: MouseEvent) => { if (!notifications.current?.contains(event.target as Node)) setNotificationsOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setNotificationsOpen(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [notificationsOpen]);

  if (!user) return null;
  const config = dashboardConfig[user.role];
  const current = config.navigation.find(item => item.path === pathname);
  const name = user.employee?.full_name || user.username;
  return (
    <div className={`app-shell${collapsed ? ' app-shell-collapsed' : ''}`}>
      <a className="app-skip-link" href="#app-content">Đến nội dung chính</a>
      {mobileOpen && <button className="app-sidebar-overlay" aria-label="Đóng menu điều hướng" onClick={() => setMobileOpen(false)} />}
      <aside ref={sidebar} id="app-sidebar" className={`app-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Thanh điều hướng" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}>
        <div className="app-brand">
          <img src={logoImg} alt="Jollibee" width={36} height={36} />
          <span className="app-brand-name">Jolli<span>Shift</span></span>
          <button className="app-icon-button app-mobile-close" aria-label="Đóng menu" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <nav className="app-navigation" aria-label={config.roleLabel}>
          {config.navigation.map(({ label, path, icon: Icon }, index) => (
            <NavLink key={path} to={path} end={index === 0} title={label} aria-label={label} onClick={() => setMobileOpen(false)} className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}>
              <Icon size={20} aria-hidden="true" /><span className="app-nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-footer"><button className="app-collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}<span className="app-nav-label">Thu gọn menu</span></button></div>
      </aside>
      <div className="app-main-column">
        <header className="app-header">
          <div className="app-header-title">
            <button ref={menuButton} className="app-icon-button app-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu điều hướng" aria-controls="app-sidebar" aria-expanded={mobileOpen}><Menu size={21} /></button>
            <h1>{current?.label || 'JolliShift'}</h1>
          </div>
          <div className="app-header-actions">
            <span className="app-branch" title={user.branch_name || 'Chưa gán chi nhánh'}><Building2 size={16} aria-hidden="true" /><span>{user.branch_name || 'Chưa gán chi nhánh'}</span></span>
            <div className="app-notifications" ref={notifications}>
              <button className="app-icon-button" aria-label="Thông báo" aria-expanded={notificationsOpen} aria-controls="app-notifications-panel" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={19} /></button>
              {notificationsOpen && <div className="app-notification-panel" id="app-notifications-panel"><h2>Thông báo</h2><p>Chưa có dữ liệu thông báo.</p></div>}
            </div>
            <div className="app-account" title={`${name} · ${config.roleLabel}`}><span className="app-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span><div className="app-account-text"><strong>{name}</strong><span>{config.roleLabel}</span></div></div>
            <button className="app-logout" onClick={() => void logout()} aria-label="Đăng xuất"><LogOut size={18} aria-hidden="true" /><span>Đăng xuất</span></button>
          </div>
        </header>
        <main id="app-content" className="app-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
};
