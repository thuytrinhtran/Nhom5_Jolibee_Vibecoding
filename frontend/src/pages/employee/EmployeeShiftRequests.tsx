import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { shiftChangeService as api } from '../../services/shift-change.service';
import { canCreate, canRespond, dateLabel, errorMessage, invitationState, scheduleIssue, shiftLabel, startAt, statusLabel, timestamp } from '../../services/shift-change.view';
import type { AssignmentsResult, Candidate, EmployeeInvitation, ShiftChangeRequest } from '../../types/shift-change';
import { ShiftChangeRequestDetails } from '../shift-change/ShiftChangeRequestDetails';
import '../shift-change/ShiftChange.css';

export function EmployeeShiftRequests() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<'create' | 'requests' | 'invitations'>('create');
  const [assignments, setAssignments] = useState<AssignmentsResult | null>(null);
  const [requests, setRequests] = useState<ShiftChangeRequest[] | null>(null);
  const [invitations, setInvitations] = useState<EmployeeInvitation[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [mutationError, setMutationError] = useState('');
  const [assignmentId, setAssignmentId] = useState(''), [reason, setReason] = useState('');
  const [mode, setMode] = useState('auto'), [candidateId, setCandidateId] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]), [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState(''), [candidateVersion, setCandidateVersion] = useState(0);
  const [expanded, setExpanded] = useState(''), [now, setNow] = useState(Date.now());
  const generation = useRef(0), submitting = useRef(false);
  const handleAuth = useCallback((error: unknown) => {
    if (error instanceof ApiError && [401, 403].includes(error.status)) void refreshUser();
  }, [refreshUser]);
  // AuthContext recreates its functions; keep the loader stable for the current actor.
  const authHandler = useRef(handleAuth); authHandler.current = handleAuth;
  const load = useCallback(async () => {
    const version = ++generation.current; setLoading(true);
    const results = await Promise.allSettled([api.assignments(), api.requests(), api.invitations()]);
    if (version !== generation.current) return;
    const nextErrors: Record<string, string> = {};
    const [a, r, i] = results;
    if (a.status === 'fulfilled') setAssignments(a.value); else { setAssignments(null); nextErrors.create = errorMessage(a.reason); authHandler.current(a.reason); }
    if (r.status === 'fulfilled') setRequests(r.value.requests); else { setRequests(null); nextErrors.requests = errorMessage(r.reason); authHandler.current(r.reason); }
    if (i.status === 'fulfilled') setInvitations(i.value.invitations); else { setInvitations(null); nextErrors.invitations = errorMessage(i.reason); authHandler.current(i.reason); }
    setErrors(nextErrors); setLoading(false);
  }, [user?.id]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setCandidateId(''); setCandidates([]); setCandidateError(''); setCandidateLoading(false);
    if (mode !== 'propose' || !assignmentId) return;
    setCandidateLoading(true);
    api.candidates(assignmentId).then(result => { if (active) setCandidates(result.candidates); })
      .catch(error => { if (active) { setCandidateError(errorMessage(error)); authHandler.current(error); } })
      .finally(() => { if (active) setCandidateLoading(false); });
    return () => { active = false; };
  }, [mode, assignmentId, candidateVersion, user?.id]);
  const selected = assignments?.assignments.find(a => a.id === assignmentId);
  const submit = async () => {
    if (submitting.current || !selected || !reason.trim() || !canCreate(selected.request_deadline_at, Date.now())
      || (mode === 'propose' && (!candidateId || candidateLoading || !!candidateError))) return;
    submitting.current = true; setBusy(true); setMessage(''); setMutationError('');
    try {
      const result = await api.create(selected.id, reason, mode === 'propose' ? candidateId : undefined);
      setMessage(`Đã gửi yêu cầu. ${result.warning ? 'Hiện không có người thay khả dụng.' : 'Đang chờ phản hồi và quyết định của quản lý.'}`);
      setReason(''); setAssignmentId(''); setTab('requests');
    } catch (error) {
      setMutationError(errorMessage(error)); authHandler.current(error);
      if (mode === 'propose') { setCandidateId(''); setCandidateVersion(v => v + 1); }
    } finally { await load(); submitting.current = false; setBusy(false); }
  };
  const respond = async (id: string, response: 'ACCEPTED' | 'DECLINED') => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setMessage(''); setMutationError('');
    try {
      const result = await api.respond(id, response);
      setMessage(result.response_recorded ? response === 'ACCEPTED' ? 'Đã đồng ý nhận ca. Cần quản lý duyệt trước khi lịch thay đổi.' : 'Đã từ chối lời mời.' : 'Lời mời đã hết hạn; phản hồi chưa được ghi nhận.');
    } catch (error) { setMutationError(errorMessage(error)); authHandler.current(error); }
    finally { await load(); submitting.current = false; setBusy(false); }
  };
  return <section className="sc-page">
    <div className="sc-heading"><div><h2>Đổi ca và lời mời</h2><p>Gửi trước giờ bắt đầu ca hơn 60 phút · Giờ Việt Nam</p></div><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''} />Tải lại</button></div>
    <div className="sc-tabs" aria-label="Nội dung đổi ca">{([['create', 'Tạo yêu cầu'], ['requests', 'Yêu cầu đã gửi'], ['invitations', 'Lời mời nhận ca']] as const).map(([key, label]) => <button key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-outline'}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {message && <p className="sc-alert sc-success" role="status">{message}</p>}
    {mutationError && <p className="sc-alert sc-error" role="alert">{mutationError} Hãy tải lại để kiểm tra dữ liệu trước khi gửi tiếp.</p>}
    {errors[tab] && <p className="sc-alert sc-error" role="alert">{errors[tab]} <button className="btn btn-outline btn-sm" disabled={loading || busy} onClick={() => void load()}>Thử tải lại</button></p>}
    {loading && <p role="status">Đang tải dữ liệu đổi ca…</p>}
    {tab === 'create' && assignments && <>
      {assignments.schedule_issues.map(issue => <p key={issue.schedule_id} className="sc-alert sc-warning">{scheduleIssue(issue.code)}</p>)}
      {!assignments.assignments.length ? <div className="card sc-empty">Không có ca đủ điều kiện gửi yêu cầu. Ca phải thuộc lịch công bố còn hiệu lực, chưa đổi và còn trước hạn T−60.</div> : <form className="card sc-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <fieldset disabled={busy || loading}><legend>Thông tin yêu cầu</legend>
          <label>Ca muốn đổi<select required value={assignmentId} onChange={e => setAssignmentId(e.target.value)}><option value="">Chọn ca làm</option>{assignments.assignments.map(a => <option key={a.id} value={a.id} disabled={!canCreate(a.request_deadline_at, now)}>{dateLabel(a.work_date)} · {shiftLabel(a.shift)}</option>)}</select></label>
          {selected && <p className="sc-hint">Hạn gửi: trước {timestamp(selected.request_deadline_at)}{!canCreate(selected.request_deadline_at, now) && ' · Đã hết hạn gửi'}</p>}
          <label>Lý do đổi ca<textarea required value={reason} onChange={e => setReason(e.target.value)} placeholder="Nhập lý do đổi ca" rows={3} /></label>
          <label>Cách tìm người thay<select value={mode} onChange={e => setMode(e.target.value)}><option value="auto">Để hệ thống tự tìm</option><option value="propose">Tự đề xuất người thay</option></select></label>
          {mode === 'propose' && <div className="sc-candidates">
            {!assignmentId ? <p>Hãy chọn ca trước để xem ứng viên đủ điều kiện.</p> : candidateLoading ? <p role="status">Đang tải ứng viên…</p> : candidateError ? <p className="sc-alert sc-error" role="alert">{candidateError} <button type="button" className="btn btn-outline btn-sm" onClick={() => setCandidateVersion(v => v + 1)}>Tải lại ứng viên</button></p> : !candidates.length ? <p className="sc-alert sc-warning">Không có ứng viên đủ điều kiện. Bạn có thể chọn “Để hệ thống tự tìm”.</p> : <label>Người thay được đề xuất<select required value={candidateId} onChange={e => setCandidateId(e.target.value)}><option value="">Chọn nhân viên</option>{candidates.map((c, index) => <option key={c.employee_id} value={c.employee_id}>{c.full_name}{candidates.filter(x => x.full_name === c.full_name).length > 1 ? ` (${index + 1})` : ''}</option>)}</select></label>}
          </div>}
          <p className="sc-hint">Đề xuất chỉ gửi lời mời cho người được chọn. Người thay phải đồng ý và quản lý duyệt; lịch chưa thay đổi khi gửi yêu cầu.</p>
          <button className="btn btn-primary" disabled={!selected || !reason.trim() || !canCreate(selected.request_deadline_at, now) || (mode === 'propose' && (!candidateId || candidateLoading || !!candidateError))}><Send size={16} />{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button>
        </fieldset>
      </form>}
    </>}
    {tab === 'requests' && requests && (!requests.length ? <div className="card sc-empty">Bạn chưa gửi yêu cầu đổi ca.</div> : <div className="sc-list">{requests.map(r => <article className="card sc-request" key={r.id}><button className="sc-toggle" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? '' : r.id)}><span><strong>{dateLabel(r.original_assignment.work_date)} · {shiftLabel(r.shift)}</strong><small>{timestamp(r.created_at)}</small></span><span className={`badge ${r.status === 'APPROVED' ? 'badge-green' : r.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'}`}>{statusLabel[r.status]}</span></button>{r.warning && <p className="sc-inline-warning">Hiện không có người thay khả dụng.</p>}{expanded === r.id && <ShiftChangeRequestDetails request={r} now={now} />}</article>)}</div>)}
    {tab === 'invitations' && invitations && (!invitations.length ? <div className="card sc-empty">Bạn chưa có lời mời nhận ca.</div> : <div className="sc-list">{invitations.map(i => <article className="card" key={i.id}><div className="sc-heading"><h3>{dateLabel(i.assignment.work_date)} · {shiftLabel({ name: i.shift_name, start_time: i.start_time, end_time: i.end_time })}</h3><span className="badge badge-slate">{statusLabel[invitationState(i, startAt(i.assignment.work_date, i.start_time), now)] === 'Chờ xử lý' ? 'Chờ phản hồi' : statusLabel[invitationState(i, startAt(i.assignment.work_date, i.start_time), now)]}</span></div><p>Hạn phản hồi: {timestamp(new Date(Math.min(Date.parse(i.expires_at), startAt(i.assignment.work_date, i.start_time))).toISOString())}</p><p className="sc-hint">Đồng ý nhận ca vẫn cần quản lý duyệt. Trạng thái có thể thay đổi; backend sẽ kiểm tra khi phản hồi.</p>{canRespond(i, now) && <div className="sc-actions"><button className="btn btn-primary" disabled={busy || loading} onClick={() => void respond(i.id, 'ACCEPTED')}>Đồng ý nhận ca</button><button className="btn btn-outline" disabled={busy || loading} onClick={() => void respond(i.id, 'DECLINED')}>Từ chối</button></div>}</article>)}</div>)}
  </section>;
}
