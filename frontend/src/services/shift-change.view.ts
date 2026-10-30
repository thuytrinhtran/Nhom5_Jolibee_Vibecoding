import type { EmployeeInvitation, InvitationStatus, RequestInvitation, ShiftChangeRequest, ShiftInfo } from '../types/shift-change';

export const statusLabel: Record<string, string> = {
  PENDING: 'Chờ xử lý', SEARCHING: 'Đang tìm người thay', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối',
  ACCEPTED: 'Đã đồng ý', DECLINED: 'Đã từ chối', EXPIRED: 'Hết hạn',
};
export const scheduleIssue = (code: string) => ({
  AMBIGUOUS_PUBLISHED_SCHEDULE: 'Có nhiều nhóm lịch đã công bố cho cùng tuần. Vui lòng liên hệ quản lý.',
  STALE_PUBLISHED_SCHEDULE: 'Đã có phiên bản lịch công bố mới hơn. Hãy tải lại dữ liệu.',
  INVALID_ASSIGNMENT: 'Phân công không còn hợp lệ để đổi ca.',
}[code] || 'Lịch làm không còn hợp lệ để đổi ca.');
export const dateLabel = (date: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short' }).format(new Date(`${date}T00:00:00+07:00`));
export const timestamp = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
export const startAt = (date: string, time: string) => Date.parse(`${date}T${time}+07:00`);
export const shiftLabel = (shift: ShiftInfo) => `${shift.name} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}${shift.end_time < shift.start_time ? ' (+1 ngày)' : ''}`;
export const openRequest = (r: ShiftChangeRequest) => r.status === 'PENDING' || r.status === 'SEARCHING';
export function invitationState(i: Pick<RequestInvitation, 'status' | 'effective_status' | 'expires_at'>, startsAt: number, now: number): InvitationStatus {
  return (i.status === 'PENDING' || i.status === 'ACCEPTED') && now >= Math.min(Date.parse(i.expires_at), startsAt) ? 'EXPIRED' : i.effective_status;
}
export function acceptedCandidates(r: ShiftChangeRequest, now: number) {
  const start = startAt(r.original_assignment.work_date, r.shift.start_time);
  return openRequest(r) && r.schedule_state === 'VALID' && now < start
    ? r.invitations.filter(i => i.eligible_now && invitationState(i, start, now) === 'ACCEPTED') : [];
}
export const canRespond = (i: EmployeeInvitation, now: number) => invitationState(i, startAt(i.assignment.work_date, i.start_time), now) === 'PENDING';
export const canCreate = (deadline: string, now: number) => now < Date.parse(deadline);
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý đổi ca. Hãy tải lại dữ liệu.';
