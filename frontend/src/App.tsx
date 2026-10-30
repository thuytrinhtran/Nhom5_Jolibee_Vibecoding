import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { PlaceholderPage } from './pages/common/PlaceholderPage';
import { ChangePassword } from './pages/ChangePassword';
import { Login } from './pages/Login';
import { ShiftRegistration } from './pages/employee/ShiftRegistration';
import { EmployeeDashboard } from './pages/employee/EmployeeDashboard';
import { ManagerDashboard } from './pages/manager/ManagerDashboard';
import { SupervisorDashboard } from './pages/supervisor/SupervisorDashboard';
import { ScheduleWorkflow } from './pages/schedules/ScheduleWorkflow';

const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        color: '#D9252A',
        fontWeight: 700
      }}>
        Đang khởi động hệ thống Jollibee...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) return <Navigate to="/change-password" replace />;

  if (user.role === 'NV') return <Navigate to="/employee" replace />;
  if (user.role === 'QL') return <Navigate to="/manager" replace />;
  if (user.role === 'GS') return <Navigate to="/supervisor" replace />;

  return <Navigate to="/login" replace />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Login Route */}
          <Route path="/login" element={<Login />} />

          <Route path="/change-password" element={<ProtectedRoute allowPasswordChange><ChangePassword /></ProtectedRoute>} />

          {/* Root Redirect based on Role */}
          <Route path="/" element={<RootRedirect />} />

          {/* Role: Nhan vien (NV) */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute allowedRoles={['NV']}>
                <AppLayout><EmployeeDashboard /></AppLayout>
              </ProtectedRoute>
            }
          />

          {/* Role: Quan ly ca (QL) */}
          <Route
            path="/manager"
            element={
              <ProtectedRoute allowedRoles={['QL']}>
                <AppLayout><ManagerDashboard /></AppLayout>
              </ProtectedRoute>
            }
          />

          {/* Role: Giam sat khu vuc (GS) */}
          <Route
            path="/supervisor"
            element={
              <ProtectedRoute allowedRoles={['GS']}>
                <AppLayout><SupervisorDashboard /></AppLayout>
              </ProtectedRoute>
            }
          />

          <Route path="/supervisor/approvals" element={<ProtectedRoute allowedRoles={['GS']}><AppLayout><ScheduleWorkflow mode="approvals" /></AppLayout></ProtectedRoute>} />
          <Route path="/supervisor/reports" element={<ProtectedRoute allowedRoles={['GS']}><AppLayout><ScheduleWorkflow mode="history" /></AppLayout></ProtectedRoute>} />
          <Route path="/manager/publish" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><ScheduleWorkflow mode="publish" /></AppLayout></ProtectedRoute>} />
          <Route path="/manager/publish-history" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><ScheduleWorkflow mode="publication-history" /></AppLayout></ProtectedRoute>} />

          <Route path="/employee/register" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><ShiftRegistration /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/*" element={
            <ProtectedRoute allowedRoles={['NV']}>
              <AppLayout><PlaceholderPage /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/manager/*" element={
            <ProtectedRoute allowedRoles={['QL']}>
              <AppLayout><PlaceholderPage /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/supervisor/*" element={
            <ProtectedRoute allowedRoles={['GS']}>
              <AppLayout><PlaceholderPage /></AppLayout>
            </ProtectedRoute>
          } />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
