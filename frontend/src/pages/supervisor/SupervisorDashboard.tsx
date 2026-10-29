import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth.service';
import { 
  Building2, 
  CheckSquare, 
  Globe, 
  History, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle 
} from 'lucide-react';

export const SupervisorDashboard: React.FC = () => {
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
              backgroundColor: '#fee2e2',
              color: '#b91c1c',
              padding: '0.2rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}>
              VAI TRÒ: GIÁM SÁT KHU VỰC (GS)
            </span>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Tài khoản: {user?.username}</span>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
            Cổng điều hành Giám sát khu vực
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
            Thẩm định & phê duyệt lịch làm các chi nhánh, điều phối nguồn lực viện trợ nhân sự liên cửa hàng.
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
            <Building2 size={14} color="#D9252A" />
            <strong>Phạm vi:</strong> Giám sát Cụm chi nhánh
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
            <ShieldCheck size={14} color="#15803d" />
            <strong>Thẩm quyền:</strong> Phê duyệt lịch & Điều phối viện trợ
          </div>
        </div>
      </div>

      {/* Grid of Planned Supervisor Modules */}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
        Các chức năng phân hệ Giám sát khu vực (Theo thiết kế UI12 - UI14)
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
            <Building2 size={20} color="#D9252A" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Tổng quan chi nhánh</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Theo dõi trạng thái nhân sự, thiếu hụt định mức và tiến độ nộp lịch của từng cửa hàng.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 2
          </span>
        </div>

        {/* Module 2 */}
        <div className="card" style={{ borderLeft: '4px solid #16a34a', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <CheckSquare size={20} color="#16a34a" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Phê duyệt lịch làm việc</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Thẩm định phương án lịch; phê duyệt để công bố hoặc yêu cầu điều chỉnh (bắt buộc nhập lý do).
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 4
          </span>
        </div>

        {/* Module 3 */}
        <div className="card" style={{ borderLeft: '4px solid #FDB813', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Globe size={20} color="#b45309" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Viện trợ liên chi nhánh</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Tạo và xử lý yêu cầu viện trợ nhân sự giữa các chi nhánh khi nội bộ không đáp ứng đủ người.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 5
          </span>
        </div>

        {/* Module 4 */}
        <div className="card" style={{ borderLeft: '4px solid #64748b', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <History size={20} color="#64748b" />
            <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Nhật ký thay đổi (Audit)</h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Truy vết lịch sử phê duyệt, snapshot phiên bản lịch và các thay đổi phân công bất biến.
          </p>
          <span style={{ fontSize: '0.75rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            Sẽ triển khai ở Sprint 4
          </span>
        </div>
      </div>

      {/* Live Backend RBAC Security Verification Card */}
      <div className="card" style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <ShieldCheck size={22} color="#b91c1c" />
          <h4 style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
            Kiểm tra phân quyền Backend API trực tiếp (RBAC Live Test)
          </h4>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
          Bấm các nút dưới đây để kiểm tra Backend Express có thực sự chặn hoặc cho phép truy cập theo đúng vai trò <strong>GS</strong> hay không:
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button
            className="btn"
            style={{ backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}
            disabled={testing}
            onClick={() => testApi('supervisor-only')}
          >
            Gọi API Dành riêng cho GS (Kỳ vọng: 200 OK)
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
            onClick={() => testApi('manager-only')}
          >
            Gọi API Dành cho QL (Kỳ vọng: 403 Forbidden)
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
