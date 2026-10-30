import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserProfile, UserRole } from '../types/auth';
import { authService, ApiError } from '../services/auth.service';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
  changePassword: (password: string, confirmation: string, nonce?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);

  const initAuth = async () => {
    const version = generation.current;
    const token = authService.getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const profile = await authService.getMe();
      if (version === generation.current) setUser(profile);
    } catch (err: any) {
      if (version !== generation.current) return;
      setError(err.message || 'Không thể khôi phục phiên đăng nhập.');
      setUser(null);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
    return () => { generation.current++; };
  }, []);

  const login = async (email: string, password: string): Promise<UserProfile> => {
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await authService.login(email, password);
      if (!data.user) {
        throw new Error('Không nhận được thông tin người dùng từ máy chủ.');
      }
      if (version !== generation.current) throw new ApiError('Phiên đã thay đổi.', 0, 'SESSION_CHANGED');
      setUser(data.user);
      return data.user;
    } catch (err: any) {
      if (version === generation.current) setError(err.message || 'Đăng nhập không thành công.');
      throw err;
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    setUser(null);
    try {
      await authService.logout();
    } catch (err: any) {
      if (version === generation.current) setError(err.message || 'Không thể thu hồi phiên trên máy chủ.');
    } finally {
      if (version === generation.current) setUser(null);
      if (version === generation.current) setLoading(false);
    }
  };

  const clearError = () => setError(null);

  const refreshUser = async (): Promise<void> => {
    const version = generation.current;
    try {
      const profile = await authService.getMe();
      if (version === generation.current) setUser(profile);
    } catch (err) {
      if (version === generation.current && err instanceof ApiError && [401, 403].includes(err.status)) setUser(null);
    }
  };

  const changePassword = async (password: string, confirmation: string, nonce?: string) => {
    const version = ++generation.current;
    const profile = await authService.changePassword(password, confirmation, nonce);
    if (version === generation.current) setUser(profile);
  };

  useEffect(() => {
    if (!user) return;
    const refresh = () => { void refreshUser(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [user?.id]);

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
        changePassword,
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
