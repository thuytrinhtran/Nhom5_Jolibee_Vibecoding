import { ApiError } from '../services/auth.service';
import type { Preference, RegistrationData } from '../services/registration.service';
import { validateSelection } from '../services/registration-selection';

/** Browser memory only. No fetch, database client or persistent storage. */
export function createRegistrationDemo(identity: string, clock = () => Date.now()) {
  let data: RegistrationData;
  const clone = <T,>(value: T): T => structuredClone(value);
  function reset() {
    const now = clock();
    const vietnam = new Date(now + 7 * 3600000);
    const monday = new Date(Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7);
    // Always display the next working week, including when today is Monday.
    if (monday.toISOString().slice(0, 10) <= vietnam.toISOString().slice(0, 10)) monday.setUTCDate(monday.getUTCDate() + 7);
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    data = {
      employee: { full_name: 'Nhân viên DEMO', branch_name: 'Chi nhánh DEMO', department_name: 'Bộ phận DEMO' },
      period: { id: `demo-${identity}`, work_start_date: monday.toISOString().slice(0, 10), work_end_date: sunday.toISOString().slice(0, 10), open_at: new Date(now - 60000).toISOString(), close_at: new Date(now + 2 * 3600000).toISOString(), status: 'OPEN' },
      shifts: [
        { id: 'demo-morning', name: 'Ca sáng', start_time: '08:00:00', end_time: '12:00:00' },
        { id: 'demo-afternoon', name: 'Ca chiều', start_time: '12:00:00', end_time: '17:00:00' },
        { id: 'demo-evening', name: 'Ca tối', start_time: '17:00:00', end_time: '22:00:00' },
      ], schedule: { timezone: 'Asia/Ho_Chi_Minh', open_iso_day: 5, open_local_time: '15:00:00', close_iso_day: 7, close_local_time: '12:00:00', reminder_minutes: 30 }, registrations: [], submission: null, server_now: new Date(now).toISOString(),
    };
  }
  reset();
  return {
    async load(): Promise<RegistrationData> { return clone({ ...data, server_now: new Date(clock()).toISOString() }); },
    async save(period: string, preferences: Preference[], mode: 'draft' | 'submit') {
      const p = data.period!;
      if (period !== p.id) throw new ApiError('DEMO: Đợt không tồn tại.', 403);
      if (p.status !== 'OPEN' || clock() < Date.parse(p.open_at) || clock() >= Date.parse(p.close_at)) throw new ApiError('DEMO: Đợt chưa mở hoặc đã đóng; không thể chỉnh sửa.', 409);
      if (!['draft', 'submit'].includes(mode) || !Array.isArray(preferences)) throw new ApiError('DEMO: Dữ liệu không hợp lệ.', 400);
      const validation = validateSelection(preferences, data);
      if (validation.length) throw new ApiError(`DEMO: ${validation.join(' ')}`, 422);
      const status = mode === 'draft' ? 'DRAFT' : 'VALID';
      const errors: string[] = [];
      data.registrations = clone(preferences.map(pref => ({ ...pref, status })));
      data.submission = { status, errors, submitted_at: mode === 'submit' ? new Date(clock()).toISOString() : null };
      if (errors.length) throw new ApiError(errors[0], 422);
      return { status: 'ok', registration_status: status, message: mode === 'draft' ? 'DEMO: Đã lưu nháp trong bộ nhớ.' : 'DEMO: Đã gửi đăng ký hợp lệ trong bộ nhớ.' };
    },
    async resetDemo() { reset(); },
    async closeDemo() { data.period!.status = 'CLOSED'; data.period!.close_at = new Date(clock()).toISOString(); },
  };
}
