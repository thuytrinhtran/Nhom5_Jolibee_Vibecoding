import { authorized } from './auth.service';
export interface Preference { work_date: string; shift_id: string }
export interface RegistrationData {
  employee: { full_name: string; branch_name?: string; department_name?: string };
  period: null | { id: string; work_start_date: string; work_end_date: string; open_at: string; close_at: string; status: string };
  shifts: { id: string; name: string; start_time: string; end_time: string }[];
  registrations: (Preference & { status: string })[];
  schedule?: { timezone: string; open_iso_day: number; open_local_time: string; close_iso_day: number; close_local_time: string; reminder_minutes: number };
  submission: null | { status: string; errors: string[]; submitted_at?: string | null };
  has_sample_data?: boolean;
  server_now: string;
}
export const registrationService = {
  async load(): Promise<RegistrationData> { return authorized('/current', {}, '/registrations'); },
  async save(period: string, preferences: Preference[], mode: 'draft' | 'submit') {
    return authorized(`/${period}/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences, mode }) }, '/registrations');
  },
};
