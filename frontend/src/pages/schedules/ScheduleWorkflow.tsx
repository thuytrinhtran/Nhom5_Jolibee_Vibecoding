import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ScheduleWorkflowError, TV4_SHIFT_DEFINITIONS, mockActorForProfile, resolveTv4MockBranch } from './scheduleWorkflow.types';
import type { ScheduleAssignment, ScheduleWorkflowService, ScheduleWorkflowView, ScheduleWorkflowRecord } from './scheduleWorkflow.types';
import { scheduleWorkflowApiService } from './scheduleWorkflow.api.service';
import './ScheduleWorkflow.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
const statusLabel: Record<string, string> = {
  DRAFT: 'Bản nháp', PENDING_APPROVAL: 'Chờ phê duyệt', NEEDS_REVISION: 'Cần điều chỉnh',
  APPROVED: 'Đã phê duyệt', PUBLISHED: 'Đã công bố',
};

function shiftChoices(): ScheduleAssignment['shifts'][] {
  return TV4_SHIFT_DEFINITIONS.map(({ id, name, start_time, end_time }) => ({ id, name, start_time, end_time }));
}

function canManagerResubmit(canPublish: boolean, schedule: Pick<ScheduleWorkflowRecord, 'status' | 'is_latest'>): boolean {
  return canPublish && schedule.status === 'NEEDS_REVISION' && schedule.is_latest;
}

function chooseShiftForAssignment(
  assignments: ScheduleAssignment[],
  selectedShifts: Record<string, string>,
  assignmentId: string,
  nextShiftId: string,
): Record<string, string> {
  const target = assignments.find(assignment => assignment.id === assignmentId);
  if (!target || !TV4_SHIFT_DEFINITIONS.some(shift => shift.id === nextShiftId)) return selectedShifts;

  const previousShiftId = selectedShifts[target.id] || target.shifts.id;
  const conflicting = assignments.find(assignment => assignment.id !== target.id
    && assignment.work_date === target.work_date
    && (selectedShifts[assignment.id] || assignment.shifts.id) === nextShiftId);

  return {
    ...selectedShifts,
    [target.id]: nextShiftId,
    ...(conflicting ? { [conflicting.id]: previousShiftId } : {}),
  };
}

type WorkflowAction = 'approve' | 'reject' | 'resubmit' | 'publish';

const actionCopy: Record<WorkflowAction, { confirmation: string; success: string }> = {
  approve: {
    confirmation: 'Bạn xác nhận phê duyệt phiên bản lịch này?',
    success: 'Lịch làm việc đã được phê duyệt.',
  },
  reject: {
    confirmation: 'Bạn xác nhận từ chối lịch với lý do đã nhập?',
    success: 'Lịch đã được chuyển sang Cần điều chỉnh và lưu lý do từ chối.',
  },
  resubmit: {
    confirmation: 'Tạo phiên bản lịch mới và gửi đến GS để phê duyệt?',
    success: 'Lịch đã được điều chỉnh và gửi đến GS để phê duyệt.',
  },
  publish: {
    confirmation: 'Bạn xác nhận công bố lịch đã được phê duyệt?',
    success: 'Lịch làm việc đã được công bố.',
  },
};

export const ScheduleWorkflow = ({
  mode,
  service = scheduleWorkflowApiService,
}: {
  mode: 'approvals' | 'history' | 'publish' | 'publication-history';
  service?: ScheduleWorkflowService;
}) => {
  const { user } = useAuth();
  const usesMockWorkflow = service.mode !== 'api';
  const branchResolution = useMemo(() => usesMockWorkflow && user?.role === 'QL' ? resolveTv4MockBranch(user) : null, [user, usesMockWorkflow]);
  const actor = useMemo(() => user ? usesMockWorkflow ? mockActorForProfile(user) : {
    id: user.id, username: user.username, role: user.role, branch_id: user.branch_id,
  } : null, [user, usesMockWorkflow]);
  const [schedules, setSchedules] = useState<ScheduleWorkflowRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [adjustmentShifts, setAdjustmentShifts] = useState<Record<string, string>>({});
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{ schedule: ScheduleWorkflowRecord; action: WorkflowAction } | null>(null);
  const canReview = actor?.role === 'GS' && mode === 'approvals';
  const canPublish = actor?.role === 'QL' && mode === 'publish';
  const view: ScheduleWorkflowView = mode === 'approvals' ? 'pending'
    : mode === 'history' ? 'history'
      : mode === 'publication-history' ? 'publicationHistory' : 'manager';

  const load = useCallback(async () => {
    if (!actor) {
      setSchedules([]);
      setError('Cần đăng nhập để xem dữ liệu TV4 giả lập.');
      setLoading(false);
      return;
    }
    if (actor.role === 'QL' && !actor.branch_id) {
      setSchedules([]);
      setError(usesMockWorkflow ? '' : 'Hồ sơ quản lý chưa có branch_id; backend không thể xác định phạm vi chi nhánh.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setSchedules(await service.listSchedules(actor, view));
    } catch (err) {
      setSchedules([]);
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [actor, branchResolution, service, view, usesMockWorkflow]);

  useEffect(() => { void load(); }, [load]);

  const perform = async (
    schedule: ScheduleWorkflowRecord,
    action: WorkflowAction,
  ) => {
    if (!actor) return;
    setBusy(true);
    setError('');
    setSuccessMessage('');
    try {
      let successMessage = actionCopy[action].success;
      if (action === 'approve') await service.decideSchedule(actor, schedule.id, 'APPROVED');
      if (action === 'reject') await service.decideSchedule(actor, schedule.id, 'NEEDS_REVISION', reason);
      if (action === 'resubmit') {
        const changedAssignments = schedule.shift_assignments.map(assignment => ({
          ...assignment,
          shifts: shiftChoices().find(shift => shift.id === adjustmentShifts[assignment.id]) || assignment.shifts,
        }));
        const submittedVersion = await service.resubmitSchedule(actor, schedule.id, adjustmentNote, changedAssignments);
        successMessage = `Lịch đã được điều chỉnh và gửi đến GS phê duyệt. Phiên bản ${submittedVersion.version} đang chờ phê duyệt.`;
      }
      if (action === 'publish') await service.publishSchedule(actor, schedule.id, new Date(deadline).toISOString());
      setSuccessMessage(successMessage);
      setReason('');
      setAdjustmentNote('');
      setDeadline('');
      setEditingScheduleId(null);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ScheduleWorkflowError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = () => {
    if (!confirmation) return;
    const { schedule, action } = confirmation;
    setConfirmation(null);
    void perform(schedule, action);
  };

  const title = mode === 'approvals' ? 'Lịch chờ phê duyệt'
    : mode === 'history' ? 'Lịch sử quyết định'
      : mode === 'publication-history' ? 'Lịch sử công bố' : 'Công bố và trình lại lịch';
  return <section className="workflow-page">
    <div className="workflow-mock-banner" role="note">
      {usesMockWorkflow
        ? 'Chế độ TV4 giả lập · Quyền dùng vai trò đăng nhập và phạm vi chi nhánh demo. Dữ liệu chỉ nằm trong bộ nhớ phiên trình duyệt; tải lại trang sẽ khôi phục bộ mẫu. Không lưu vào Supabase.'
        : 'Dữ liệu TV4 được tải qua Backend. Backend xác minh phiên đăng nhập, vai trò và phạm vi chi nhánh; thao tác ghi phụ thuộc migration TV4 đã được triển khai.'}
    </div>
    {usesMockWorkflow && actor?.role === 'QL' && branchResolution && !branchResolution.fixtureBranchId && <div className="workflow-alert error" role="alert">
      {branchResolution.diagnostic}
    </div>}
    <div className="workflow-heading">
      <div>
        <h2>{title}</h2>
        <p>{mode === 'approvals' ? `Giám sát xem lịch thuộc phạm vi được giao${usesMockWorkflow ? ' trong dữ liệu demo' : ''}.`
          : mode === 'history' ? `Tra cứu quyết định đã lưu${usesMockWorkflow ? ' trong bộ dữ liệu demo' : ' trên backend'}.`
            : mode === 'publication-history' ? 'Lịch đã công bố cùng thông tin do API hiện có trả về.'
              : 'Quản lý xem lịch trong phạm vi chi nhánh; công bố lịch đã duyệt.'}</p>
      </div>
      <button className="workflow-button secondary" onClick={() => void load()} disabled={loading}>Tải lại</button>
    </div>
    {error && <div className="workflow-alert error" role="alert">{error}<button className="workflow-button secondary" onClick={() => void load()} disabled={loading}>Thử tải lại</button></div>}
    {loading ? <div className="workflow-empty" role="status">{usesMockWorkflow ? 'Đang tải dữ liệu giả lập…' : 'Đang tải dữ liệu từ Backend…'}</div>
      : error ? null
        : schedules.length === 0 ? <div className="workflow-empty"><strong>{actor?.role === 'QL' && !actor.branch_id ? (usesMockWorkflow ? 'Chưa ánh xạ được chi nhánh hồ sơ sang fixture TV4' : 'Hồ sơ chưa được gán chi nhánh') : 'Chưa có lịch trong danh sách này'}</strong><p>{actor?.role === 'QL' && actor.branch_id ? `Không có lịch thuộc phạm vi ${usesMockWorkflow ? branchResolution?.fixtureBranchName || actor.branch_id : actor.branch_id} trong các trạng thái API trả về. Lịch PENDING_APPROVAL nằm trong hàng chờ GS.` : usesMockWorkflow ? 'Dữ liệu mẫu có thể được khôi phục bằng cách tải lại trang.' : 'Backend hiện không trả bản ghi phù hợp với bộ lọc này.'}</p></div>
        : <div className="workflow-list">{schedules.map(schedule => {
          const open = selected === schedule.id;
          const entries = schedule.shift_assignments || [];
          const latest = schedule.approvals?.[0];
          const canResubmit = usesMockWorkflow && canManagerResubmit(canPublish, schedule);
          const canPublishSchedule = canPublish && schedule.status === 'APPROVED' && schedule.is_latest;
          return <article className="workflow-card" key={schedule.id}>
            <button className="workflow-card-toggle" onClick={() => {
              setSelected(open ? null : schedule.id);
              setReason(''); setAdjustmentNote(''); setAdjustmentShifts({}); setDeadline('');
              setEditingScheduleId(null);
            }} aria-expanded={open}>
              <span>
                <strong>{schedule.branches.name} · Phiên bản {schedule.version}</strong>
                <small>{schedule.registration_periods.work_start_date} – {schedule.registration_periods.work_end_date}</small>
              </span>
              <span className={`workflow-status ${schedule.status.toLowerCase()}`}>{statusLabel[schedule.status] || schedule.status}</span>
            </button>
            {!schedule.is_latest && <div className="workflow-stale" role="status">Phiên bản cũ · Đã có phiên bản mới hơn; không thể duyệt hoặc công bố bản này.</div>}
            {latest && <div className="workflow-decision">
              {latest.decision === 'APPROVED' ? 'Quyết định: Đã phê duyệt' : 'Quyết định: Cần điều chỉnh'}
              {' · '}{latest.users.username}{' · '}{new Date(latest.decided_at).toLocaleString('vi-VN')}
              {latest.reason && <p>Lý do: {latest.reason}</p>}
            </div>}
            {schedule.status === 'PUBLISHED' && <div className="workflow-decision">
              Đã công bố bởi {schedule.published_by_username || schedule.published_by || 'API chưa trả người công bố'} · {schedule.published_at ? new Date(schedule.published_at).toLocaleString('vi-VN') : 'Chưa có thời điểm'}
            </div>}
            {open && <div className="workflow-details">
              <h3>Chi tiết phân công ({entries.length})</h3>
              {entries.length ? <div className="workflow-table-wrap"><table><thead><tr><th>Ngày</th><th>Ca</th>{canResubmit && editingScheduleId === schedule.id && <th>Ca điều chỉnh</th>}<th>Nhân viên</th><th>Bộ phận</th><th>Trạng thái lịch</th></tr></thead><tbody>
                {entries.map(entry => <tr key={entry.id}>
                  <td>{entry.work_date}</td>
                  <td>{entry.shifts.name} ({entry.shifts.start_time.slice(0, 5)}–{entry.shifts.end_time.slice(0, 5)})</td>
                  {canResubmit && editingScheduleId === schedule.id && <td><select aria-label={`Ca điều chỉnh cho ${entry.employees.full_name}`} value={adjustmentShifts[entry.id] || entry.shifts.id} onChange={event => setAdjustmentShifts(current => chooseShiftForAssignment(schedule.shift_assignments, current, entry.id, event.target.value))}>
                    {shiftChoices().map(shift => <option key={shift.id} value={shift.id}>{shift.name} ({shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)})</option>)}
                  </select></td>}
                  <td>{entry.employees.full_name}</td><td>{entry.departments.name}</td>
                  <td>{statusLabel[schedule.status] || schedule.status}</td>
                </tr>)}
              </tbody></table></div> : <p>Phiên bản lịch này chưa có phân công.</p>}
              {schedule.resubmission_note && <p className="workflow-revision-note">Ghi chú điều chỉnh khi trình lại: {schedule.resubmission_note}</p>}
              {!usesMockWorkflow && canPublish && schedule.status === 'NEEDS_REVISION' && <p className="workflow-revision-note">API trình lại phiên bản lịch chưa có; chức năng này cần phối hợp với TV3.</p>}
              {schedule.approvals.length > 0 && <div className="workflow-approval-history">
                <h3>Lịch sử phiên bản</h3>
                {schedule.approvals.map(item => <p key={item.id}>
                  {item.decision === 'APPROVED' ? 'Đã phê duyệt' : 'Cần điều chỉnh'} · {item.users.username} · {new Date(item.decided_at).toLocaleString('vi-VN')}
                  {item.reason ? ` — ${item.reason}` : ''}
                </p>)}
              </div>}
              {canReview && schedule.status === 'PENDING_APPROVAL' && !schedule.is_latest && <p className="workflow-stale">Không thể xử lý phiên bản cũ.</p>}
              {canReview && schedule.status === 'PENDING_APPROVAL' && schedule.is_latest && <div className="workflow-actions">
                <button className="workflow-button primary" disabled={busy} onClick={() => setConfirmation({ schedule, action: 'approve' })}>Phê duyệt</button>
                <label className="workflow-reason">Lý do từ chối<textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={2000} placeholder="Nhập nội dung cần quản lý ca điều chỉnh" /></label>
                <button className="workflow-button danger" disabled={busy || !reason.trim()} onClick={() => setConfirmation({ schedule, action: 'reject' })}>Từ chối</button>
              </div>}
              {canResubmit && editingScheduleId !== schedule.id && <div className="workflow-actions">
                <button className="workflow-button primary" disabled={busy} onClick={() => setEditingScheduleId(schedule.id)}>Điều chỉnh lịch</button>
              </div>}
              {canResubmit && editingScheduleId === schedule.id && <div className="workflow-actions">
                <label className="workflow-reason">Tóm tắt điều chỉnh<textarea value={adjustmentNote} onChange={event => setAdjustmentNote(event.target.value)} required maxLength={2000} placeholder="Mô tả nội dung điều chỉnh của phiên bản mới" /></label>
                <button className="workflow-button primary" disabled={busy || !adjustmentNote.trim() || !schedule.shift_assignments.some(entry => adjustmentShifts[entry.id] && adjustmentShifts[entry.id] !== entry.shifts.id)} onClick={() => setConfirmation({ schedule, action: 'resubmit' })}>Điều chỉnh</button>
                <button className="workflow-button secondary" disabled={busy} onClick={() => { setEditingScheduleId(null); setAdjustmentNote(''); setAdjustmentShifts({}); }}>H&#7911;y &#273;i&#7873;u ch&#7881;nh</button>
              </div>}
              {canPublishSchedule && <div className="workflow-actions">
                <label>Thời hạn phản hồi<input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>
                <button className="workflow-button primary" disabled={busy || !deadline} onClick={() => setConfirmation({ schedule, action: 'publish' })}>Công bố lịch</button>
              </div>}
            </div>}
          </article>;
        })}</div>}
    {successMessage && <div className="workflow-modal-backdrop">
      <section className="workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-success-title" aria-describedby="workflow-success-message">
        <div className="workflow-modal-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" /><path d="m14 24 7 7 14-15" /></svg></div>
        <h2 id="workflow-success-title">Thao tác thành công</h2>
        <p id="workflow-success-message">{successMessage}</p>
        <button className="workflow-button primary" autoFocus onClick={() => setSuccessMessage('')}>Hoàn tất</button>
      </section>
    </div>}
    {confirmation && <div className="workflow-modal-backdrop">
      <section className="workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-confirm-title" aria-describedby="workflow-confirm-message">
        <h2 id="workflow-confirm-title">Xác nhận thao tác</h2>
        <p id="workflow-confirm-message">{actionCopy[confirmation.action].confirmation}</p>
        {confirmation.action === 'reject' && <p className="workflow-modal-detail">Lý do: {reason.trim()}</p>}
        {confirmation.action === 'resubmit' && <p className="workflow-modal-detail">Ghi chú: {adjustmentNote.trim()}</p>}
        <div className="workflow-modal-actions">
          <button className="workflow-button secondary" disabled={busy} onClick={() => setConfirmation(null)}>Hủy</button>
          <button className={`workflow-button ${confirmation.action === 'reject' ? 'danger' : 'primary'}`} disabled={busy} onClick={confirmAction}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
        </div>
      </section>
    </div>}
  </section>;
};
