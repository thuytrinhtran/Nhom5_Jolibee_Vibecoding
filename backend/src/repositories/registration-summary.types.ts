import type { Assignment, Employee, Registration, Requirement, SchedulingInput, Shift } from '../services/scheduling.engine.js';
export type SummarySource = 'mock' | 'supabase';
export type SummaryEmployee = Omit<Employee, 'is_active' | 'role' | 'skills'> & {
  branch_id: string; full_name: string; is_active: boolean | null; role: string | null; skills: string[] | null;
};
export interface SummarySnapshot {
  source: SummarySource; branch: { id: string; name: string }; period: SchedulingInput['period'];
  departments: { id: string; name: string }[];
  employees: SummaryEmployee[]; shifts: (Shift & { name: string })[];
  registrations: (Registration & { id: string; period_id: string })[];
  requirements: (Requirement & { sales_forecast_ref?: string | null; updated_at?: string; created_by?: string })[]; existing: (Assignment & {id?:string})[];
  new_employee_count_threshold: number | null;
  test_rules?: {max_shifts_per_day:number};
}
export interface SummaryPeriodOption {
  id: string; branch_id: string; work_start_date: string; work_end_date: string; status: string;
  schedules: { id: string; status: string; version: number; created_at: string }[];
}
export interface RegistrationSummaryRepository {
  readonly source: SummarySource;
  listPeriods(branchId: string): Promise<SummaryPeriodOption[]>;
  load(branchId: string, periodId: string): Promise<SummarySnapshot>;
  saveRequirement(branchId: string, periodId: string, actorId: string, input: DemandInput, existingId: string | null): Promise<DemandRequirement>;
  clearRequirement(branchId: string, periodId: string, id: string, expected: string): Promise<void>;
}

export interface DemandInput {
  work_date: string; shift_id: string; department_id: string; required_count: number;
  required_skill_name: string | null; sales_forecast_ref: string | null; expected_updated_at: string | null;
}
export interface DemandRequirement extends Requirement {
  sales_forecast_ref: string | null; updated_at: string; created_by: string;
}
