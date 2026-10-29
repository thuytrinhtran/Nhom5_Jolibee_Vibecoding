import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth.service';
import { 
  Users, 
  Calendar, 
  Sparkles, 
  Send, 
  ArrowLeftRight, 
  Building, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle 
} from 'lucide-react';

export const ManagerDashboard: React.FC = () => {
  const { user } = useAuth();
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  const testApi = async (endpoint: 'employee-only' | 'manager-only' | 'supervisor-only') => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authService.testRoleEndpoint(endpoint);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ status: 'error', message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1rem' }}>
      {/* Top Banner */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '1.5rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{
              backgroundColor: '#fef3c7',
              color: '#b45309',
              padding: '0.2rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}>
              VAI TRÒ: QUẢN LÝ CA (QL)
            </span>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Tài khoản: {user?.username}</span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
            Bảng điều khiển Quản lý ca Jollibee
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
            Điều phối nhu cầu nhân sự, lập lịch làm dự kiến, tương tác với AI và xử lý các yêu cầu đổi ca.
          </p>
        </div>

        {/* Profile Card Summary */}
        <div style={{
          backgroundColor: '#f8fafc',
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          fontSize: '0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155', marginBottom: '0.25rem' }}>
            <Building size={14} color="#D9252A" />
            <strong>Chi nhánh phụ trách:</strong> {user?.branch_name || 'Chưa gán'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
            <ShieldCheck size={14} color="#15803d" />
            <strong>Trạng thái:</strong> Đang hoạt động (Active)
          </div>
        </div>
      </div>

      {/* Grid of Planned Manager Modules */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
        Các chức năng phân hệ Quản lý ca (Theo thiết kế UI06 - UI11)
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
      }}>
        {/* Module 1 */}
        <div className="card" style={{ borderLeft: '4px solid #D9252A', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Users size={20} color="#D9252A" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Nhu cầu nhân sự</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Nhập số người cần từ Sales Forecast theo ngày/ca/bộ phận (không gồm Crew Leader).
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 2
          </span>
        </div>

        {/* Module 2 */}
        <div className="card" style={{ borderLeft: '4px solid #FDB813', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Calendar size={20} color="#b45309" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Lập lịch & Đối chiếu</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Tạo phương án lịch dự kiến; kiểm tra điều kiện cứng (Hard constraints) bằng Rule Engine.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 3
          </span>
        </div>

        {/* Module 3 */}
        <div className="card" style={{ borderLeft: '4px solid #8b5cf6', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Sparkles size={20} color="#8b5cf6" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Trợ lý AI Đánh giá</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            AI nhận xét cơ cấu kinh nghiệm; phát cảnh báo ca nhiều NV mới và không có Crew Training.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 3
          </span>
        </div>

        {/* Module 4 */}
        <div className="card" style={{ borderLeft: '4px solid #0284c7', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Send size={20} color="#0284c7" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Trình phê duyệt lịch</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Trình phiên bản lịch lên Giám sát khu vực duyệt (chặn submit nếu thiếu người).
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 4
          </span>
        </div>

        {/* Module 5 */}
        <div className="card" style={{ borderLeft: '4px solid #16a34a', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <ArrowLeftRight size={20} color="#16a34a" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Xử lý Đổi ca & Sự cố</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Hàng đợi yêu cầu đổi ca; xem kết quả tìm người thay và ra quyết định xác nhận.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 5
          </span>
        </div>
      </div>

      {/* Live Backend RBAC Security Verification Card */}
      <div className="card" style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <ShieldCheck size={22} color="#b45309" />
          <h4 style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
            Kiểm tra phân quyền Backend API trực tiếp (RBAC Live Test)
          </h4>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
          Bấm các nút dưới đây để kiểm tra Backend Express có thực sự chặn hoặc cho phép truy cập theo đúng vai trò <strong>QL</strong> hay không:
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button
            className="btn"
            style={{ backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}
            disabled={testing}
            onClick={() => testApi('manager-only')}
          >
            Gọi API Dành riêng cho QL (Kỳ vọng: 200 OK)
          </button>
          <button
            className="btn"
            style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}
            disabled={testing}
            onClick={() => testApi('employee-only')}
          >
            Gọi API Dành cho NV (Kỳ vọng: 403 Forbidden)
          </button>
          <button
            className="btn"
            style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}
            disabled={testing}
            onClick={() => testApi('supervisor-only')}
          >
            Gọi API Dành cho GS (Kỳ vọng: 403 Forbidden)
          </button>
        </div>

        {testResult && (
          <div style={{
            padding: '1rem',
            borderRadius: '8px',
            backgroundColor: testResult.status === 'ok' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${testResult.status === 'ok' ? '#bbf7d0' : '#fecaca'}`,
            fontSize: '0.85rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              {testResult.status === 'ok' ? (
                <CheckCircle2 size={18} color="#16a34a" />
              ) : (
                <XCircle size={18} color="#dc2626" />
              )}
              <span>Kết quả phản hồi từ Backend Express:</span>
            </div>
            <pre style={{ margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#334155' }}>
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
