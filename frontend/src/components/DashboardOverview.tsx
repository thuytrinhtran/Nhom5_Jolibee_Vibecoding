import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dashboardConfig } from '../dashboard.config';
import type { UserRole } from '../types/auth';

export const DashboardOverview = ({ role }: { role: UserRole }) => {
  const { user } = useAuth();
  const config = dashboardConfig[role];
  const name = user?.employee?.full_name || user?.username;
  return (
    <div className="dashboard-overview">
      <section className="dashboard-greeting" aria-label="Lời chào">
        <h2>Xin chào{name ? `, ${name}` : ''}!</h2>
        <p>Chúc bạn một ngày làm việc thuận lợi.</p>
      </section>
      <section className="dashboard-metrics" aria-label="Thông tin tổng quan">
        {config.metrics.map(({ label, icon: Icon }) => (
          <article className="dashboard-metric" key={label}>
            <div className="dashboard-metric-heading"><span>{label}</span><Icon size={20} aria-hidden="true" /></div>
            <p className="dashboard-no-data">Chưa có dữ liệu</p>
          </article>
        ))}
      </section>
      <section aria-labelledby="quick-actions-title">
        <div className="dashboard-section-heading"><h2 id="quick-actions-title">{role === 'QL' ? 'Thao tác nhanh' : 'Truy cập nhanh'}</h2></div>
        <div className="dashboard-actions">
          {config.actions.map(({ label, description, path, icon: Icon }) => (
            <Link className="dashboard-action" to={path} key={path}>
              <span className="dashboard-action-icon"><Icon size={22} aria-hidden="true" /></span>
              <ArrowUpRight className="dashboard-action-arrow" size={18} aria-hidden="true" />
              <h3>{label}</h3><p>{description}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="dashboard-work-panel" aria-labelledby="work-panel-title">
        <div className="dashboard-section-heading"><h2 id="work-panel-title">{config.emptyTitle}</h2></div>
        <div className="dashboard-empty"><CalendarDays size={28} aria-hidden="true" /><h3>Chưa có dữ liệu</h3><p>{config.emptyDescription}</p></div>
      </section>
    </div>
  );
};
