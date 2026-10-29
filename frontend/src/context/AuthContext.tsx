import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types/auth';
import { authService } from '../services/auth.service';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const initAuth = async () => {
    const token = authService.getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const profile = await authService.getMe();
      setUser(profile);
    } catch (err: any) {
      console.warn('Initial session check failed:', err.message);
      authService.clearStoredToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
  }, []);

  const login = async (email: string, password: string): Promise<UserProfile> => {
    setLoading(true);
    setError(null);
    try {
      const data = await authService.login(email, password);
      if (!data.user) {
        throw new Error('Không nhận được thông tin người dùng từ máy chủ.');
      }
      setUser(data.user);
      return data.user;
    } catch (err: any) {
      setError(err.message || 'Đăng nhập không thành công.');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setLoading(true);
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setError(null);
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  const refreshUser = async (): Promise<void> => {
    try {
      const profile = await authService.getMe();
      setUser(profile);
    } catch (err) {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user ? user.role : null,
        loading,
        error,
        login,
        logout,
        clearError,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
