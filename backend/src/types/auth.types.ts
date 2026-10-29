export type UserRole = 'NV' | 'QL' | 'GS';

export interface EmployeeInfo {
  id: string;
  full_name: string;
  skill_level: string;
  department_id: string;
  department_name?: string;
  phone?: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username: string;
  role: UserRole;
  branch_id: string | null;
  branch_name?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  password_reset_id?: string | null;
  employee?: EmployeeInfo | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
