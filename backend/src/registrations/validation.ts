export class RegistrationError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export interface Preference { work_date: string; shift_id: string }
export interface Shift { id: string; start_time: string; end_time: string }
export function parsePreferences(body: unknown): { preferences: Preference[]; mode: 'draft' | 'submit' } {
  const b = body as Record<string, unknown> | null;
  if (!b || Object.keys(b).some(k => !['preferences', 'mode'].includes(k)) || !Array.isArray(b.preferences) || typeof b.mode !== 'string' || !['draft', 'submit'].includes(b.mode))
    throw new RegistrationError('Chỉ gửi mode (draft/submit) và preferences.', 400);
  if (b.preferences.length > 500) throw new RegistrationError('Danh sách nguyện vọng quá lớn.', 400);
  const preferences = b.preferences.map((p: any) => {
    if (!p || Object.keys(p).some(k => !['work_date', 'shift_id'].includes(k)) || typeof p.work_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.work_date) || !Number.isFinite(Date.parse(p.work_date)) || new Date(p.work_date).toISOString().slice(0, 10) !== p.work_date || typeof p.shift_id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.shift_id))
      throw new RegistrationError('Mỗi nguyện vọng cần ngày hợp lệ và mã ca hợp lệ.', 400);
    return { work_date: p.work_date, shift_id: p.shift_id };
  });
  return { preferences, mode: b.mode as 'draft' | 'submit' };
}
export function validatePreferences(preferences: Preference[], shifts: Shift[], start: string, end: string): string[] {
  const errors: string[] = [], seen = new Set<string>(), intervals: { start: number; end: number }[] = [];
  for (const p of preferences) {
    const key = `${p.work_date}/${p.shift_id}`;
    if (seen.has(key)) errors.push(`Trùng nguyện vọng ngày ${p.work_date}.`);
    seen.add(key);
    if (p.work_date < start || p.work_date > end) errors.push(`Ngày ${p.work_date} ngoài tuần đăng ký.`);
    const shift = shifts.find(s => s.id === p.shift_id);
    if (!shift) { errors.push(`Ca ngày ${p.work_date} không còn hợp lệ.`); continue; }
    const minute = (t: string) => { const [h,m,s = '0'] = t.split(':'); return Number(h)*60+Number(m)+Number(s)/60; };
    const base = Date.parse(p.work_date) / 60000;
    const a = base + minute(shift.start_time), b = base + minute(shift.end_time) + (shift.end_time <= shift.start_time ? 1440 : 0);
    if (intervals.some(i => a < i.end && b > i.start)) errors.push(`Ca ngày ${p.work_date} bị trùng giờ (kể cả ca qua đêm).`);
    intervals.push({ start: a, end: b });
  }
  return [...new Set(errors)];
}
