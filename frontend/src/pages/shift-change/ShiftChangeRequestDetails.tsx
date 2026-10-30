import type { ReactNode } from 'react';
import type { ShiftChangeRequest } from '../../types/shift-change';
import { dateLabel, invitationState, scheduleIssue, shiftLabel, startAt, statusLabel, timestamp } from '../../services/shift-change.view';

export function ShiftChangeRequestDetails({ request: r, now, children }: { request: ShiftChangeRequest; now: number; children?: ReactNode }) {
  const start = startAt(r.original_assignment.work_date, r.shift.start_time);
  const replacement = r.invitations.find(i => i.target_employee_id === r.replacement_employee_id);
  return <div className="sc-details">
    <dl className="sc-facts">
      <div><dt>Người yêu cầu</dt><dd>{r.requesting_employee_name}</dd></div>
      <div><dt>Ngày / ca</dt><dd>{dateLabel(r.original_assignment.work_date)} · {shiftLabel(r.shift)}</dd></div>
      <div><dt>Gửi lúc</dt><dd>{timestamp(r.created_at)}</dd></div>
      <div><dt>Xử lý lúc</dt><dd>{timestamp(r.resolved_at)}</dd></div>
    </dl>
    <p className="sc-reason"><strong>Lý do:</strong> {r.reason}</p>
    {r.schedule_state !== 'VALID' && <p className="sc-alert sc-warning">{scheduleIssue(r.schedule_state)}</p>}
    {r.warning && <p className="sc-alert sc-warning">Hiện không có người thay khả dụng.</p>}
    {r.status === 'APPROVED' && <p className="sc-alert sc-success">Đã cập nhật phân công cho {replacement?.full_name || 'người được duyệt'}. Ca đã đổi không được đổi lần hai.{r.replacement_assignment_id && <small>Mã phân công mới: {r.replacement_assignment_id}</small>}</p>}
    <h3>Lời mời nhận ca</h3>
    {!r.invitations.length ? <p className="sc-empty">Chưa có lời mời nhận ca.</p> : <div className="sc-table-wrap" tabIndex={0} aria-label="Danh sách lời mời"><table>
      <thead><tr><th scope="col">Nhân viên</th><th scope="col">Phản hồi</th><th scope="col">Hạn phản hồi</th><th scope="col">Điều kiện hiện tại</th></tr></thead>
      <tbody>{r.invitations.map(i => { const state = invitationState(i, start, now); return <tr key={i.id}><td>{i.full_name}</td><td><span className="badge badge-slate">{state === 'PENDING' ? 'Chờ phản hồi' : statusLabel[state]}</span></td><td>{timestamp(new Date(Math.min(Date.parse(i.expires_at), start)).toISOString())}</td><td>{r.status === 'APPROVED' || r.status === 'REJECTED' ? 'Yêu cầu đã đóng' : i.eligible_now ? 'Đủ điều kiện' : 'Không còn đủ điều kiện'}</td></tr>; })}</tbody>
    </table></div>}
    {children}
  </div>;
}
