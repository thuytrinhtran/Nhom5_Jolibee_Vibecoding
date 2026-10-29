import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { dashboardConfig } from '../../dashboard.config';

export const PlaceholderPage = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const config = dashboardConfig[user.role];
  const title = config.navigation.find(item => item.path === pathname)?.label || 'Trang chưa sẵn sàng';
  return (
    <section className="app-placeholder"><h2>{title}</h2><p>Tính năng này chưa sẵn sàng. Vui lòng quay lại sau.</p>
      <Link className="btn btn-primary" to={config.navigation[0].path}><ArrowLeft size={16} aria-hidden="true" />Về Tổng quan</Link>
    </section>
  );
};
