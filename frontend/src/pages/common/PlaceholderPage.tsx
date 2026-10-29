import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Construction, ArrowLeft } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({
  title,
  description = 'Tính năng đang được phát triển theo lộ trình nghiệp vụ của JolliShift.',
  icon,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const getDashboardPath = () => {
    if (user?.role === 'NV') return '/employee';
    if (user?.role === 'QL') return '/manager';
    if (user?.role === 'GS') return '/supervisor';
    return '/';
  };

  return (
    <div style={{
      maxWidth: '680px',
      margin: '3rem auto',
      textAlign: 'center',
    }}>
      <div className="card" style={{ padding: '3rem 2rem' }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          backgroundColor: 'var(--primary-subtle)',
          color: 'var(--primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem auto',
          border: '1px solid var(--primary-border)',
        }}>
          {icon || <Construction size={32} />}
        </div>

        <span className="badge badge-yellow" style={{ marginBottom: '1rem' }}>
          Đang hoàn thiện tính năng
        </span>

        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
          {title}
        </h3>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', maxWidth: '460px', margin: '0 auto 2rem auto', lineHeight: 1.6 }}>
          {description}
        </p>

        <button
          onClick={() => navigate(getDashboardPath())}
          className="btn btn-primary"
        >
          <ArrowLeft size={16} />
          <span>Quay về trang Tổng quan</span>
        </button>
      </div>
    </div>
  );
};
