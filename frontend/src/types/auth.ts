export type UserRole = 'NV' | 'QL' | 'GS';

export interface EmployeeInfo {
  id: string;
  full_name: string;
  skill_level: 'NEW' | 'REGULAR' | 'CREW_TRAINING' | 'CREW_LEADER' | string;
  department_id: string;
  department_name?: string;
  phone?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  branch_id: string | null;
  branch_name?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  employee?: EmployeeInfo | null;
}

export interface LoginResponse {
  status: 'ok' | 'error';
  message: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: UserProfile;
  details?: string;
}
