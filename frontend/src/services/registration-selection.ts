import type { Preference, RegistrationData } from './registration.service';

export function toggleShift(preferences: Preference[], day: string, shift: string): Preference[] {
 return preferences.some(p => p.work_date===day && p.shift_id===shift)
   ? preferences.filter(p => p.work_date!==day || p.shift_id!==shift)
   : [...preferences,{work_date:day,shift_id:shift}];
}
export function dayDeclaration(preferences: Preference[], status: string | undefined, day: string): 'NOT_SUBMITTED' | 'OFF' | 'SHIFT' {
 if (status !== 'VALID') return 'NOT_SUBMITTED';
 return preferences.some(p => p.work_date===day) ? 'SHIFT' : 'OFF';
}
export function validateSelection(preferences: Preference[], data: RegistrationData): string[] {
  if (!data.period) return ['Chưa có đợt đăng ký.'];
  const errors = new Set<string>();
  const keys = new Set<string>();
  const validDate = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day && day >= data.period!.work_start_date && day <= data.period!.work_end_date;
  const slots: { start: number; end: number }[] = [];
  for (const pref of preferences) {
    const shift = data.shifts.find(s => s.id === pref.shift_id);
    if (!validDate(pref.work_date) || !shift) { errors.add('Ngày hoặc ca không hợp lệ.'); continue; }
    const key = `${pref.work_date}/${pref.shift_id}`;
    if (keys.has(key)) errors.add('Trùng nguyện vọng ngày và ca.');
    keys.add(key);
    const start = Date.parse(`${pref.work_date}T${shift.start_time}+07:00`);
    const end = Date.parse(`${pref.work_date}T${shift.end_time}+07:00`) + (shift.end_time < shift.start_time ? 86400000 : 0);
    if (slots.some(s => start < s.end && end > s.start)) errors.add('Các ca bị trùng giờ, kể cả ca qua đêm.');
    slots.push({ start, end });
  }
  return [...errors];
}
