import React, { lazy } from 'react';
import './workspace.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { PlaceholderPage } from './pages/common/PlaceholderPage';
import { ChangePassword } from './pages/ChangePassword';
import { Login } from './pages/Login';
const ShiftRegistration = lazy(() => import('./pages/employee/ShiftRegistration').then(module => ({ default: module.ShiftRegistration })));
const EmployeeSupport = lazy(() => import('./pages/employee/EmployeeSupport').then(module => ({ default: module.EmployeeSupport })));
const EmployeeDashboard = lazy(() => import('./pages/employee/EmployeeDashboard').then(module => ({ default: module.EmployeeDashboard })));
const EmployeeSchedule = lazy(() => import('./pages/employee/EmployeeSchedule').then(module => ({ default: module.EmployeeSchedule })));
const ShiftChanges = lazy(() => import('./pages/employee/ShiftChanges').then(module => ({ default: module.ShiftChanges })));
const ManagerDashboard = lazy(() => import('./pages/manager/ManagerDashboard').then(module => ({ default: module.ManagerDashboard })));
const ManagerSchedule = lazy(() => import('./pages/manager/ManagerSchedule').then(module => ({ default: module.ManagerSchedule })));
const ManagerCalendar = lazy(() => import('./pages/manager/ManagerCalendar').then(module => ({ default: module.ManagerCalendar })));
const OfficialSchedule = lazy(() => import('./pages/manager/OfficialSchedule').then(module => ({ default: module.OfficialSchedule })));
const ManagerDemand = lazy(() => import('./pages/manager/ManagerDemand').then(module => ({ default: module.ManagerDemand })));
const EmployeeCompetency = lazy(() => import('./pages/manager/EmployeeCompetency').then(module => ({ default: module.EmployeeCompetency })));
const SupervisorDashboard = lazy(() => import('./pages/supervisor/SupervisorDashboard').then(module => ({ default: module.SupervisorDashboard })));
const ScheduleWorkflow = lazy(() => import('./pages/schedules/ScheduleWorkflow').then(module => ({ default: module.ScheduleWorkflow })));

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

          <Route path="/manager/registrations" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><ManagerCalendar /></AppLayout></ProtectedRoute>} />
          <Route path="/manager/official-schedule" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><OfficialSchedule /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/support" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><EmployeeSupport /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/register" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><ShiftRegistration /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/schedule" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><EmployeeSchedule /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/shift-requests" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><EmployeeSupport initialTab="request" /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/incidents" element={<ProtectedRoute allowedRoles={['NV']}><AppLayout><EmployeeSupport initialTab="incident" /></AppLayout></ProtectedRoute>} />
          <Route path="/manager/shift-requests" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><ShiftChanges /></AppLayout></ProtectedRoute>} />
          <Route path="/employee/*" element={
            <ProtectedRoute allowedRoles={['NV']}>
              <AppLayout><PlaceholderPage /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/manager/demand" element={
            <ProtectedRoute allowedRoles={['QL']}>
              <AppLayout><ManagerDemand /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/manager/schedule" element={
            <ProtectedRoute allowedRoles={['QL']}>
              <AppLayout><ManagerSchedule /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/manager/staff" element={<Navigate to="/manager/staff/competency" replace />} />
          <Route path="/manager/staff/competency" element={<ProtectedRoute allowedRoles={['QL']}><AppLayout><EmployeeCompetency /></AppLayout></ProtectedRoute>} />
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
