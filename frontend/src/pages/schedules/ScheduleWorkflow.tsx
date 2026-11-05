import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
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

export function publicationDeadlineError(value:string,now=Date.now()):string|null {
  if(!value)return 'Nhập thời hạn phản hồi trong tương lai để bật nút Công bố lịch.';
  const instant=Date.parse(value);
  return !Number.isFinite(instant)||instant<=now?'Thời hạn phản hồi phải là thời điểm hợp lệ trong tương lai.':null;
}

export function WorkflowInspection({scheduleId,service}:{scheduleId:string;service:ScheduleWorkflowService}){
  const [result,setResult]=useState<Awaited<ReturnType<NonNullable<ScheduleWorkflowService['reviewSchedule']>>>|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;
    if(service.reviewSchedule)void service.reviewSchedule(scheduleId).then(r=>{if(active)setResult(r);}).catch(e=>{if(active)setError(errorText(e));});
    return()=>{active=false;};
  },[scheduleId,service]);
  if(!service.reviewSchedule)return null;
  if(error)return <p role="alert">Không thể kiểm tra dữ liệu hiện tại: {error}</p>;
  if(!result)return <p role="status">Đang kiểm tra định biên và cơ cấu kinh nghiệm…</p>;
  return <section aria-label="Kiểm tra nghiệp vụ lịch">
    <p>Kiểm tra lịch: {result.validation.hard_constraints==='PASS'?'Đạt':'Cần kiểm tra'} · {result.ready?'Đủ điều kiện xử lý':'Cần xử lý cảnh báo trước khi tiếp tục'}</p>
    {!result.workflow_enabled&&<p>Chức năng xử lý lịch chưa được bật cho tuần này.</p>}
    {[...result.validation.issues,...result.validation.warnings].map((w,i)=><p key={i}>{w.message}</p>)}
    <details><summary>Xem định biên và cơ cấu từng ca ({result.validation.coverage.length} ô)</summary><div className="workflow-table-wrap"><table><thead><tr><th>Ngày</th><th>Ca / bộ phận</th><th>Đã xếp / nhu cầu</th><th>Kinh nghiệm / mục tiêu</th><th>Còn thiếu</th></tr></thead><tbody>
      {result.validation.coverage.map(c=><tr key={c.id}><td>{c.work_date}</td><td>{result.labels?.shifts[c.shift_id]??c.shift_id} / {result.labels?.departments[c.department_id]??c.department_id}</td><td>{c.assigned_count}/{c.required_count}</td><td>{c.experienced_count}/{c.experienced_target}</td><td>{c.missing_count} người · {c.missing_experienced_count} kinh nghiệm</td></tr>)}
    </tbody></table></div></details>
  </section>;
}

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
  const [scheduleRows, setSchedules] = useState<ScheduleWorkflowRecord[]>([]);
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
  const [weekFilter,setWeekFilter]=useState(''),[stateFilter,setStateFilter]=useState(''),[dayFilter,setDayFilter]=useState(''),[departmentFilter,setDepartmentFilter]=useState(''),[assignmentPage,setAssignmentPage]=useState(0);
  useEffect(()=>{setAssignmentPage(0);},[selected,dayFilter,departmentFilter]);
  const canReview = actor?.role === 'GS' && mode === 'approvals';
  const canPublish = actor?.role === 'QL' && mode === 'publish';
  const view: ScheduleWorkflowView = mode === 'approvals' ? 'pending'
    : mode === 'history' ? 'history'
      : mode === 'publication-history' ? 'publicationHistory' : 'manager';
  const scope=JSON.stringify([actor?.id,actor?.role,actor?.branch_id,view]);
  const [loadedScope,setLoadedScope]=useState(scope);
  const schedules=loadedScope===scope?scheduleRows:[];
  const loadSequence=useRef(0),working=useRef(false),currentScope=useRef(scope);
  currentScope.current=scope;

  const load = useCallback(async () => {
    if(currentScope.current!==scope)return;
    const request=++loadSequence.current;
    if (!actor) {
      setSchedules([]);
      setError('Cần đăng nhập để xem dữ liệu TV4.');
      setLoading(false);
      return;
    }
    if (actor.role === 'QL' && !actor.branch_id) {
      setSchedules([]);
      setError(usesMockWorkflow ? '' : 'Tài khoản chưa được phân công chi nhánh. Vui lòng liên hệ quản trị viên.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result=await service.listSchedules(actor, view);
      if(request!==loadSequence.current||currentScope.current!==scope)return;
      setSchedules(result);setLoadedScope(scope);
    } catch (err) {
      if(request!==loadSequence.current||currentScope.current!==scope)return;
      setSchedules([]);
      setError(errorText(err));
    } finally {
      if(request===loadSequence.current&&currentScope.current===scope)setLoading(false);
    }
  }, [actor, branchResolution, service, view, usesMockWorkflow,scope]);

  useEffect(() => { void load();return()=>{loadSequence.current++;}; }, [load]);
  useEffect(()=>{setSelected(null);setConfirmation(null);setReason('');setDeadline('');setSuccessMessage('');},[scope]);

  const perform = async (
    schedule: ScheduleWorkflowRecord,
    action: WorkflowAction,
  ) => {
    if (!actor||working.current||currentScope.current!==scope) return;
    if(action==='publish'){
      const invalid=publicationDeadlineError(deadline);
      if(invalid){setError(invalid);return;}
    }
    working.current=true;
    loadSequence.current++;
    setLoading(false);
    setBusy(true);
    setError('');
    setSuccessMessage('');
    try {
      let successMessage = actionCopy[action].success;
      if (action === 'approve') await service.decideSchedule(actor, schedule.id, 'APPROVED','',schedule.version);
      if (action === 'reject') await service.decideSchedule(actor, schedule.id, 'NEEDS_REVISION', reason,schedule.version);
      if (action === 'resubmit') {
        const changedAssignments = schedule.shift_assignments.map(assignment => ({
          ...assignment,
          shifts: shiftChoices().find(shift => shift.id === adjustmentShifts[assignment.id]) || assignment.shifts,
        }));
        const submittedVersion = await service.resubmitSchedule(
          actor, schedule.id, adjustmentNote, changedAssignments, schedule.version, schedule.schedule_group_id,
        );
        successMessage = `Lịch đã được điều chỉnh và gửi đến GS phê duyệt. Phiên bản ${submittedVersion.version} đang chờ phê duyệt.`;
      }
      if (action === 'publish') await service.publishSchedule(actor, schedule.id, new Date(deadline).toISOString(),schedule.version);
      if(currentScope.current!==scope)return;
      setSuccessMessage(successMessage);
      setReason('');
      setAdjustmentNote('');
      setDeadline('');
      setEditingScheduleId(null);
      setSelected(null);
      await load();
    } catch (err) {
      if(currentScope.current===scope)setError(err instanceof ScheduleWorkflowError ? err.message : errorText(err));
    } finally {
      working.current=false;
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
  const emptyTitle = usesMockWorkflow && actor?.role === 'QL' && !actor.branch_id
    ? 'Chưa xác định được chi nhánh dữ liệu thử nghiệm'
    : usesMockWorkflow ? 'Chưa có lịch trong danh sách này' : 'Chưa có lịch làm việc phù hợp.';
  const emptyDescription = !usesMockWorkflow
    ? mode === 'publish'
      ? 'Lịch của cửa hàng sẽ xuất hiện sau khi lưu bản nháp. Nhấn “Làm mới” để kiểm tra.'
      : mode === 'approvals'
        ? 'Hiện chưa có lịch chờ phê duyệt phù hợp.'
        : mode === 'history'
          ? 'Chưa có lịch sử quyết định phù hợp.'
          : 'Chưa có lịch đã công bố phù hợp.'
    : actor?.role === 'QL' && actor.branch_id
      ? 'Không có lịch phù hợp với danh sách này. Lịch chờ phê duyệt được hiển thị trong hàng chờ của GS.'
      : actor?.role === 'QL' && !actor.branch_id
        ? 'Vui lòng kiểm tra cấu hình chi nhánh dữ liệu thử nghiệm.'
        : 'Dữ liệu mẫu có thể được khôi phục bằng cách tải lại trang.';
  return <section className="workflow-page">
    <div className="workflow-mock-banner" role="note">
      {usesMockWorkflow
        ? 'Chế độ TV4 giả lập · Quyền dùng vai trò đăng nhập và phạm vi chi nhánh demo. Dữ liệu chỉ nằm trong bộ nhớ phiên trình duyệt; tải lại trang sẽ khôi phục bộ mẫu. Không lưu vào Supabase.'
        : 'Phê duyệt và công bố là hai bước riêng. Nhân viên chỉ xem lịch sau khi cửa hàng công bố.'}
    </div>
    <div className="workspace-filters"><label>Tuần làm việc<select value={weekFilter} onChange={e=>setWeekFilter(e.target.value)}><option value="">Tất cả tuần</option>{[...new Set(schedules.map(s=>s.registration_periods.work_start_date))].sort().map(d=><option key={d} value={d}>{d}</option>)}</select></label><label>Trạng thái<select value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option value="">Tất cả trạng thái</option>{[...new Set(schedules.map(s=>s.status))].map(s=><option key={s} value={s}>{statusLabel[s]??s}</option>)}</select></label></div>
    {usesMockWorkflow && actor?.role === 'QL' && branchResolution && !branchResolution.fixtureBranchId && <div className="workflow-alert error" role="alert">
      Không thể xác định chi nhánh dữ liệu thử nghiệm cho tài khoản này. Vui lòng kiểm tra cấu hình demo.
    </div>}
    <div className="workflow-heading">
      <div>
        <h2>{title}</h2>
        <p>{mode === 'approvals' ? `Giám sát xem lịch thuộc phạm vi được giao${usesMockWorkflow ? ' trong dữ liệu demo' : ''}.`
          : mode === 'history' ? `Tra cứu quyết định đã lưu${usesMockWorkflow ? ' trong bộ dữ liệu demo' : ' trên backend'}.`
            : mode === 'publication-history' ? 'Lịch đã công bố cùng thông tin do API hiện có trả về.'
              : 'Quản lý xem lịch trong phạm vi chi nhánh; công bố lịch đã duyệt.'}</p>
      </div>
      <button className="workflow-button secondary" onClick={() => void load()} disabled={loading}>Làm mới</button>
    </div>
    {error && <div className="workflow-alert error" role="alert">{error}<button className="workflow-button secondary" onClick={() => void load()} disabled={loading}>Thử lại</button></div>}
    {loading ? <div className="workflow-empty" role="status">{usesMockWorkflow ? 'Đang tải dữ liệu giả lập…' : 'Đang tải lịch làm việc...'}</div>
      : error ? null
        : schedules.length === 0 ? <div className="workflow-empty" role="status">
          {!usesMockWorkflow && mode === 'publish' && <CalendarDays size={30} aria-hidden="true" />}
          <strong>{emptyTitle}</strong>
          <p>{!usesMockWorkflow && mode === 'publish' ? <em>{emptyDescription}</em> : emptyDescription}</p>
        </div>
        : <div className="workflow-list">{schedules.filter(s=>(!weekFilter||s.registration_periods.work_start_date===weekFilter)&&(!stateFilter||s.status===stateFilter)).map(schedule => {
          const open = selected === schedule.id;
          const entries = schedule.shift_assignments || [];
          const filteredEntries=entries.filter(e=>(!dayFilter||e.work_date===dayFilter)&&(!departmentFilter||e.departments.name===departmentFilter));
          const latest = schedule.approvals?.[0];
          const canResubmit = usesMockWorkflow && canManagerResubmit(canPublish, schedule);
          const canPublishSchedule = canPublish && schedule.status === 'APPROVED' && schedule.is_latest;
          return <article className="workflow-card" key={schedule.id}>
            <button className="workflow-card-toggle" onClick={() => {
              setSelected(open ? null : schedule.id);
              setDayFilter('');setDepartmentFilter('');setAssignmentPage(0);
              setReason(''); setAdjustmentNote(''); setAdjustmentShifts({}); setDeadline('');
              setEditingScheduleId(null);
            }} aria-expanded={open}>
              <span>
                <strong>{schedule.branches.name}</strong>
                <small>{schedule.registration_periods.work_start_date} – {schedule.registration_periods.work_end_date}</small>
              </span>
              <span data-schedule-status={schedule.status} className={`workflow-status ${schedule.status.toLowerCase()}`}>{statusLabel[schedule.status] || schedule.status}</span>
            </button>
            {!schedule.is_latest && <div className="workflow-stale" role="status">Phiên bản cũ · Đã có phiên bản mới hơn; không thể duyệt hoặc công bố bản này.</div>}
            {latest && <div className="workflow-decision">
              {latest.decision === 'APPROVED' ? 'Quyết định: Đã phê duyệt' : 'Quyết định: Cần điều chỉnh'}
              {' · '}{latest.users.username}{' · '}{new Date(latest.decided_at).toLocaleString('vi-VN')}
              {latest.reason && <p>Lý do: {latest.reason}</p>}
            </div>}
            {schedule.status === 'PUBLISHED' && <div className="workflow-decision">
              Đã công bố bởi {schedule.published_by_username || 'Quản lý cửa hàng'} · {schedule.published_at ? new Date(schedule.published_at).toLocaleString('vi-VN') : 'Chưa có thời điểm'}
            </div>}
            {open && <div className="workflow-details">
              <WorkflowInspection scheduleId={schedule.id} service={service}/>
              {!usesMockWorkflow&&canPublish&&schedule.is_latest&&schedule.status==='DRAFT'&&<a className="workflow-button primary" href={`/manager/schedule?period_id=${encodeURIComponent(schedule.period_id)}`}>Mở bản nháp và gửi phê duyệt</a>}
              {schedule.status==='PENDING_APPROVAL'&&<p>Đang chờ giám sát phê duyệt. Nhân viên chưa nhìn thấy lịch này.</p>}
              {canReview && schedule.status === 'PENDING_APPROVAL' && schedule.is_latest && <div className="workflow-actions">
                <button className="workflow-button primary" disabled={busy||schedule.workflow_enabled===false} onClick={() => setConfirmation({ schedule, action: 'approve' })}>Phê duyệt</button>
                <label className="workflow-reason">Lý do từ chối<textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={2000} placeholder="Nhập nội dung cần quản lý ca điều chỉnh" /></label>
                <button className="workflow-button danger" disabled={busy || !reason.trim()||schedule.workflow_enabled===false} onClick={() => setConfirmation({ schedule, action: 'reject' })}>Từ chối</button>
              </div>}
              {canPublishSchedule && <div className="workflow-actions">
                <label>Thời hạn phản hồi<input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>
                {publicationDeadlineError(deadline)&&<p role="status">{publicationDeadlineError(deadline)}</p>}
                <p>Lịch đã phê duyệt chưa hiển thị cho nhân viên. Nhập thời hạn phản hồi, bấm Công bố lịch rồi Xác nhận.</p>
                <button className="workflow-button primary" disabled={busy || !!publicationDeadlineError(deadline)||schedule.workflow_enabled===false} onClick={() => setConfirmation({ schedule, action: 'publish' })}>Công bố lịch</button>
              </div>}
              <h3>Chi tiết phân công ({entries.length})</h3>
              <div className="workspace-filters"><label>Ngày<select value={dayFilter} onChange={e=>setDayFilter(e.target.value)}><option value="">Tất cả ngày</option>{[...new Set(entries.map(e=>e.work_date))].sort().map(d=><option key={d} value={d}>{d}</option>)}</select></label><label>Bộ phận<select value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)}><option value="">Tất cả bộ phận</option>{[...new Set(entries.map(e=>e.departments.name))].map(d=><option key={d} value={d}>{d}</option>)}</select></label></div>
              {entries.length ? <div className="workflow-table-wrap"><table><thead><tr><th>Ngày</th><th>Ca</th>{canResubmit && editingScheduleId === schedule.id && <th>Ca điều chỉnh</th>}<th>Nhân viên</th><th>Bộ phận</th><th>Trạng thái lịch</th></tr></thead><tbody>
                {filteredEntries.slice(assignmentPage*20,(assignmentPage+1)*20).map(entry => <tr key={entry.id}>
                  <td>{entry.work_date}</td>
                  <td>{entry.shifts.name} ({entry.shifts.start_time.slice(0, 5)}–{entry.shifts.end_time.slice(0, 5)})</td>
                  {canResubmit && editingScheduleId === schedule.id && <td><select aria-label={`Ca điều chỉnh cho ${entry.employees.full_name}`} value={adjustmentShifts[entry.id] || entry.shifts.id} onChange={event => setAdjustmentShifts(current => chooseShiftForAssignment(schedule.shift_assignments, current, entry.id, event.target.value))}>
                    {shiftChoices().map(shift => <option key={shift.id} value={shift.id}>{shift.name} ({shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)})</option>)}
                  </select></td>}
                  <td>{entry.employees.full_name}</td><td>{entry.departments.name}</td>
                  <td>{statusLabel[schedule.status] || schedule.status}</td>
                </tr>)}
              </tbody></table></div> : <p>Phiên bản lịch này chưa có phân công.</p>}
              {entries.length>0&&<nav className="workspace-pagination" aria-label="Phân trang chi tiết"><button disabled={!assignmentPage} onClick={()=>setAssignmentPage(p=>p-1)}>Trước</button><span>{filteredEntries.length} phân công · Trang {assignmentPage+1}/{Math.max(1,Math.ceil(filteredEntries.length/20))}</span><button disabled={(assignmentPage+1)*20>=filteredEntries.length} onClick={()=>setAssignmentPage(p=>p+1)}>Sau</button></nav>}
              {schedule.resubmission_note && <p className="workflow-revision-note">Ghi chú điều chỉnh khi trình lại: {schedule.resubmission_note}</p>}
              {!usesMockWorkflow && canPublish && schedule.status==='NEEDS_REVISION' && schedule.is_latest && <a className="workflow-button primary" href={`/manager/schedule?period_id=${encodeURIComponent(schedule.period_id)}`}>Chỉnh sửa, lưu bản nháp và gửi lại</a>}
              {schedule.approvals.length > 0 && <div className="workflow-approval-history">
                <h3>Lịch sử phiên bản</h3>
                {schedule.approvals.map(item => <p key={item.id}>
                  {item.decision === 'APPROVED' ? 'Đã phê duyệt' : 'Cần điều chỉnh'} · {item.users.username} · {new Date(item.decided_at).toLocaleString('vi-VN')}
                  {item.reason ? ` — ${item.reason}` : ''}
                </p>)}
              </div>}
              {canReview && schedule.status === 'PENDING_APPROVAL' && !schedule.is_latest && <p className="workflow-stale">Không thể xử lý phiên bản cũ.</p>}
              
              {canResubmit && editingScheduleId !== schedule.id && <div className="workflow-actions">
                <button className="workflow-button primary" disabled={busy} onClick={() => setEditingScheduleId(schedule.id)}>Điều chỉnh lịch</button>
              </div>}
              {canResubmit && editingScheduleId === schedule.id && <div className="workflow-actions">
                <label className="workflow-reason">Tóm tắt điều chỉnh<textarea value={adjustmentNote} onChange={event => setAdjustmentNote(event.target.value)} required maxLength={2000} placeholder="Mô tả nội dung điều chỉnh của phiên bản mới" /></label>
                <button className="workflow-button primary" disabled={busy || !adjustmentNote.trim() || !schedule.shift_assignments.some(entry => adjustmentShifts[entry.id] && adjustmentShifts[entry.id] !== entry.shifts.id)} onClick={() => setConfirmation({ schedule, action: 'resubmit' })}>Điều chỉnh</button>
                <button className="workflow-button secondary" disabled={busy} onClick={() => { setEditingScheduleId(null); setAdjustmentNote(''); setAdjustmentShifts({}); }}>H&#7911;y &#273;i&#7873;u ch&#7881;nh</button>
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
        {confirmation.action === 'publish'&&<p className="workflow-modal-detail">Thời hạn phản hồi: {new Date(deadline).toLocaleString('vi-VN')}</p>}
        {confirmation.action === 'resubmit' && <p className="workflow-modal-detail">Ghi chú: {adjustmentNote.trim()}</p>}
        <div className="workflow-modal-actions">
          <button className="workflow-button secondary" disabled={busy} onClick={() => setConfirmation(null)}>Hủy</button>
          <button className={`workflow-button ${confirmation.action === 'reject' ? 'danger' : 'primary'}`} disabled={busy} onClick={confirmAction}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
        </div>
      </section>
    </div>}
  </section>;
};
