import { LoginResponse, UserProfile } from '../types/auth';

const TOKEN_KEY = 'jollishift_access_token';
const REFRESH_KEY = 'jollishift_refresh_token';
const EXPIRY_KEY = 'jollishift_expires_at';
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth${path}`, { ...options, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new ApiError('Không kết nối được API. Kiểm tra Backend và cấu hình VITE_API_URL/proxy.', 0);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new ApiError(`API trả về phản hồi rỗng hoặc không phải JSON (HTTP ${response.status}). Kiểm tra Backend và proxy.`, response.status);
  }
  if (!response.ok) throw new ApiError(data?.message || `Yêu cầu thất bại (HTTP ${response.status}).`, response.status, data?.code);
  if (!data || data.status !== 'ok') throw new ApiError('Phản hồi API không hợp lệ.', 502);
  return data;
}

function validateProfile(user: UserProfile | undefined): asserts user is UserProfile {
  if (!user || !['NV', 'QL', 'GS'].includes(user.role) || user.is_active !== true || !user.id || typeof user.username !== 'string' || typeof user.must_change_password !== 'boolean') {
    throw new ApiError('Thông tin tài khoản hoặc vai trò không hợp lệ.', 403);
  }
}
function storeSession(data: LoginResponse) {
  if (!data.access_token || !data.refresh_token || !data.expires_at) throw new ApiError('API không trả về phiên đăng nhập đầy đủ.', 502);
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(EXPIRY_KEY, String(data.expires_at));
}
let refreshPromise: Promise<void> | null = null;
let sessionVersion = 0;
async function refreshSession(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) throw new ApiError('Phiên đã hết hạn. Vui lòng đăng nhập lại.', 401);
  const version = sessionVersion;
  refreshPromise = (async () => {
    const data = await request('/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (version !== sessionVersion) throw new ApiError('Phiên đã kết thúc.', 401);
    validateProfile(data.user);
    storeSession(data);
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function authorized(path: string, options: RequestInit = {}) {
  const expiry = Number(localStorage.getItem(EXPIRY_KEY));
  if (localStorage.getItem(REFRESH_KEY) && expiry && expiry * 1000 <= Date.now() + 60000) await refreshSession();
  const send = () => request(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${authService.getStoredToken() || ''}` } });
  try { return await send(); } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !localStorage.getItem(REFRESH_KEY)) throw error;
    await refreshSession();
    return send();
  }
}
export const authService = {
  getStoredToken(): string | null { return localStorage.getItem(TOKEN_KEY); },
  clearStoredToken(): void {
    sessionVersion++;
    for (const key of [TOKEN_KEY, REFRESH_KEY, EXPIRY_KEY]) localStorage.removeItem(key);
  },
  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await request('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    validateProfile(data.user);
    sessionVersion++;
    storeSession(data);
    return data;
  },
  async getMe(): Promise<UserProfile> {
    if (!this.getStoredToken()) throw new ApiError('Vui lòng đăng nhập.', 401);
    try {
      const data = await authorized('/me');
      validateProfile(data.user);
      return data.user;
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) this.clearStoredToken();
      throw error;
    }
  },
  async getPasswordPolicy(): Promise<{ minLength: number; maxLength: number; required: string[] }> {
    return (await authorized('/password-policy')).policy;
  },
  async changePassword(password: string, confirmation: string, nonce?: string): Promise<UserProfile> {
    const data = await authorized('/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirmation, ...(nonce ? { nonce } : {}) }) });
    validateProfile(data.user);
    return data.user;
  },
  async reauthenticate(): Promise<void> { await authorized('/reauthenticate', { method: 'POST' }); },
  async logout(): Promise<void> {
    try {
      if (this.getStoredToken()) await authorized('/logout', { method: 'POST' });
    } finally { this.clearStoredToken(); }
  },
  async testRoleEndpoint(endpoint: 'employee-only' | 'manager-only' | 'supervisor-only'): Promise<{ status: string; message: string }> {
    return authorized(`/test/${endpoint}`);
  },
};
