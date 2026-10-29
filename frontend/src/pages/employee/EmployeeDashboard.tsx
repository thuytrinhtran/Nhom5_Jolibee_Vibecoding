import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  Calendar, 
  Clock, 
  ArrowLeftRight, 
  User, 
  Building, 
  Briefcase, 
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

export const EmployeeDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const skillLevelMap: Record<string, string> = {
    NEW: 'Nhân viên mới (Mới)',
    REGULAR: 'Nhân viên thường',
    CREW_TRAINING: 'Huấn luyện viên (Crew Training)',
    CREW_LEADER: 'Trưởng nhóm ca (Crew Leader)',
  };

  const displayName = user?.employee?.full_name || user?.username || 'Nhân viên';
  const skillLabel = user?.employee?.skill_level ? (skillLevelMap[user.employee.skill_level] || user.employee.skill_level) : 'Chưa cập nhật';

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* 1. Welcome Greeting */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.625rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
          Xin chào, {displayName} 👋
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
          Theo dõi lịch phân công và tình trạng đăng ký ca làm việc của bạn.
        </p>
      </div>

      {/* 2. Key Operational Metrics */}
      <div className="stat-grid">
        {/* Metric 1 */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kỳ đăng ký tuần tới</span>
            <span className="badge badge-yellow">Mở thứ Sáu 15:00</span>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Đợt đăng ký định kỳ
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Hạn chót gửi nguyện vọng: 12:00 Chủ nhật
          </div>
        </div>

        {/* Metric 2 */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Lịch làm tuần này</span>
            <span className="badge badge-green">Đã công bố</span>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Ca đã được phê duyệt
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Theo dõi phân công tại cửa hàng
          </div>
        </div>

        {/* Metric 3 */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Yêu cầu đổi ca</span>
            <span className="badge badge-slate">0 chờ xử lý</span>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Tình trạng đổi ca
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Cửa sổ đổi ca trong 30 phút sau công bố
          </div>
        </div>
      </div>

      {/* 3. Primary Quick Action Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1.25rem',
        marginBottom: '1.75rem',
      }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}>
              <Calendar size={24} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Đăng ký ca làm việc
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Đăng ký nguyện vọng làm việc các ngày trong tuần tiếp theo. Hệ thống tự động kiểm tra tính hợp lệ và không trùng lặp.
            </p>
          </div>
          <button
            onClick={() => navigate('/employee/register')}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <span>Đi đến biểu mẫu đăng ký</span>
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-subtle)',
              color: '#a16207',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}>
              <Clock size={24} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Lịch làm cá nhân
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Xem bảng lịch làm việc chi tiết từng ngày, thời gian bắt đầu và kết thúc của các ca được phân công chính thức.
            </p>
          </div>
          <button
            onClick={() => navigate('/employee/schedule')}
            className="btn btn-outline"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <span>Xem lịch làm việc cá nhân</span>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 4. Personnel Profile Overview Card */}
      <div className="card">
        <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Hồ sơ công tác
        </h4>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          backgroundColor: '#f8fafc',
          padding: '1.25rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <Building size={14} />
              <span>Cửa hàng công tác</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              {user?.branch_name || 'Chi nhánh Jollibee'}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <Briefcase size={14} />
              <span>Bộ phận chuyên môn</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              {user?.employee?.department_name || 'Bộ phận Bếp'}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <User size={14} />
              <span>Cấp độ kỹ năng</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              {skillLabel}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <ShieldCheck size={14} />
              <span>Tình trạng hồ sơ</span>
            </div>
            <div>
              <span className="badge badge-green">Đang hoạt động</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
