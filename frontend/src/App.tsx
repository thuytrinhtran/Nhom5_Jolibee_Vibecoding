import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { EmployeeDashboard } from './pages/employee/EmployeeDashboard';
import { ManagerDashboard } from './pages/manager/ManagerDashboard';
import { SupervisorDashboard } from './pages/supervisor/SupervisorDashboard';

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

          {/* Root Redirect based on Role */}
          <Route path="/" element={<RootRedirect />} />

          {/* Role: Nhan vien (NV) */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute allowedRoles={['NV']}>
                <Navbar />
                <EmployeeDashboard />
              </ProtectedRoute>
            }
          />

          {/* Role: Quan ly ca (QL) */}
          <Route
            path="/manager"
            element={
              <ProtectedRoute allowedRoles={['QL']}>
                <Navbar />
                <ManagerDashboard />
              </ProtectedRoute>
            }
          />

          {/* Role: Giam sat khu vuc (GS) */}
          <Route
            path="/supervisor"
            element={
              <ProtectedRoute allowedRoles={['GS']}>
                <Navbar />
                <SupervisorDashboard />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
