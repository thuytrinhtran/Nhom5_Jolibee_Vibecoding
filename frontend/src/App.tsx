import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Layers, 
  Users, 
  ShieldCheck,
  Server
} from 'lucide-react';

interface HealthData {
  status: string;
  message: string;
  timestamp: string;
  service: string;
  version: string;
  environment: string;
}

export const App: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string>('');

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      // Connect to backend via Vite proxy or direct relative path
      const res = await fetch('/api/health');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data: HealthData = await res.json();
      setHealth(data);
      setLastChecked(new Date().toLocaleTimeString('vi-VN'));
    } catch (err: any) {
      setError(err.message || 'Không thể kết nối đến Backend Express');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="container">
      {/* Header Banner */}
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '2.5rem' }}>🐝</span>
          <h1 style={{ fontSize: '2rem', color: '#D9252A', fontWeight: 800 }}>
            JOLLIBEE SHIFT SCHEDULING SYSTEM
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          Đồ án MIS3047 – Quản lý Quy trình Kinh doanh | <strong>Nhóm 5</strong>
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <span className="badge badge-success">
            Sprint 1 - Bước 1: Khởi tạo cấu trúc ứng dụng hoàn tất
          </span>
        </div>
      </header>

      {/* Backend Health Check Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Server style={{ color: '#D9252A' }} size={28} />
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Trạng thái kết nối Backend Express</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Endpoint: <code>/api/health</code> | Port: <code>5000</code>
              </p>
            </div>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={checkHealth}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {loading ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
          </button>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          {loading && !health ? (
            <div className="badge badge-loading">
              <RefreshCw size={14} /> Đang kết nối đến Backend...
            </div>
          ) : error ? (
            <div style={{ backgroundColor: '#fee2e2', border: '1px solid #fecaca', padding: '1rem', borderRadius: '8px', color: '#991b1b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <AlertCircle size={20} /> Kết nối thất bại: {error}
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                Vui lòng đảm bảo Backend Express đã được khởi động ở cổng 5000 (<code>npm run dev</code> trong thư mục <code>backend</code>).
              </p>
            </div>
          ) : health ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <span className="badge badge-success">
                  <CheckCircle2 size={16} /> Backend Hoạt động bình thường (Status: {health.status.toUpperCase()})
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Lần kiểm tra gần nhất: {lastChecked}
                </span>
              </div>
              <pre className="code-block">
{JSON.stringify(health, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      {/* Target Specs Summary Grid */}
      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.75rem', marginTop: '2rem' }}>
        Tổng quan Thiết kế Hệ thống (Tuân thủ Hồ sơ Design & Intent)
      </h3>
      <div className="grid-3">
        {/* Card 1: 3 Vai trò */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Users size={22} color="#D9252A" />
            <h4 style={{ fontWeight: 700 }}>3 Vai trò người dùng</h4>
          </div>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            <li><strong>Nhân viên:</strong> Đăng ký lịch, xem ca, đổi ca, báo sự cố.</li>
            <li><strong>Quản lý ca:</strong> Nhập nhu cầu, tạo lịch, duyệt đổi ca.</li>
            <li><strong>Giám sát khu vực:</strong> Phê duyệt lịch, điều phối viện trợ.</li>
          </ul>
        </div>

        {/* Card 2: 4 Cấp độ kỹ năng */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <ShieldCheck size={22} color="#D9252A" />
            <h4 style={{ fontWeight: 700 }}>4 Cấp độ nhân viên</h4>
          </div>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            <li><strong>Mới & Thường:</strong> Tham gia đăng ký tuần.</li>
            <li><strong>Crew Training:</strong> Ưu tiên cân đối ca có NV mới.</li>
            <li><strong>Crew Leader:</strong> Lịch riêng full-time, không đăng ký qua form Thứ Sáu.</li>
          </ul>
        </div>

        {/* Card 3: Kiến trúc kỹ thuật */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Layers size={22} color="#D9252A" />
            <h4 style={{ fontWeight: 700 }}>Công nghệ chuẩn</h4>
          </div>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            <li><strong>Frontend:</strong> React 18, Vite, TypeScript</li>
            <li><strong>Backend:</strong> Node.js, Express, TypeScript</li>
            <li><strong>Database:</strong> PostgreSQL (Supabase 18 bảng)</li>
            <li><strong>Automation:</strong> n8n + Gemini AI Assistant</li>
          </ul>
        </div>
      </div>

      {/* Footer Info */}
      <footer style={{ marginTop: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <p>Jollibee Shift Scheduling System &copy; 2026 - Nhóm 5 MIS3047</p>
        <p style={{ marginTop: '0.25rem' }}>Trường Đại học Kinh tế – Đại học Đà Nẵng</p>
      </footer>
    </div>
  );
};

export default App;
