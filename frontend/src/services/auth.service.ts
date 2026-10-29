import { LoginResponse, UserProfile } from '../types/auth';

const TOKEN_KEY = 'jollishift_access_token';

export const authService = {
  getStoredToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  setStoredToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearStoredToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data: LoginResponse = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Đăng nhập thất bại.');
    }

    if (data.access_token) {
      this.setStoredToken(data.access_token);
    }
    return data;
  },

  async getMe(): Promise<UserProfile> {
    const token = this.getStoredToken();
    if (!token) {
      throw new Error('Chưa có mã xác thực.');
    }

    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await res.json();
    if (!res.ok) {
      this.clearStoredToken();
      throw new Error(data.message || 'Phiên làm việc đã hết hạn.');
    }

    return data.user;
  },

  async logout(): Promise<void> {
    const token = this.getStoredToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch (e) {
        // Ignore network errors on logout
      }
    }
    this.clearStoredToken();
  },

  async testRoleEndpoint(endpoint: 'employee-only' | 'manager-only' | 'supervisor-only'): Promise<{ status: string; message: string }> {
    const token = this.getStoredToken();
    const res = await fetch(`/api/auth/test/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  }
};
