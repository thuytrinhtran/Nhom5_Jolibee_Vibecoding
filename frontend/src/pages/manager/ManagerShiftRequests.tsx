import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { shiftChangeService as api } from '../../services/shift-change.service';
import { acceptedCandidates, dateLabel, errorMessage, openRequest, shiftLabel, statusLabel, timestamp } from '../../services/shift-change.view';
import type { ShiftChangeRequest } from '../../types/shift-change';
import { ShiftChangeRequestDetails } from '../shift-change/ShiftChangeRequestDetails';
import '../shift-change/ShiftChange.css';

export function ManagerShiftRequests() {
  const { user, refreshUser } = useAuth();
  const [requests, setRequests] = useState<ShiftChangeRequest[] | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [filter, setFilter] = useState(''), [selectedId, setSelectedId] = useState('');
  const [employeeId, setEmployeeId] = useState(''), [reason, setReason] = useState('');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0), submitting = useRef(false), authRefresh = useRef(refreshUser);
  authRefresh.current = refreshUser;
  const handleAuth = (e: unknown) => { if (e instanceof ApiError && [401, 403].includes(e.status)) void authRefresh.current(); };
  const load = useCallback(async () => {
    const version = ++generation.current; setLoading(true); setLoadError('');
    try { const result = await api.requests(); if (version === generation.current) { setRequests(result.requests); setEmployeeId(''); } }
    catch (e) { if (version === generation.current) { setRequests(null); setLoadError(errorMessage(e)); handleAuth(e); } }
    finally { if (version === generation.current) setLoading(false); }
  }, [user?.id]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const selected = requests?.find(r => r.id === selectedId);
  const candidates = selected ? acceptedCandidates(selected, now) : [];
  const selectedEmployee = candidates.find(i => i.target_employee_id === employeeId);
  const act = async (action: 'APPROVED' | 'REJECTED' | 'refresh') => {
    if (submitting.current || !selected || !openRequest(selected) || loading) return;
    const validEmployee = acceptedCandidates(selected, Date.now()).find(i => i.target_employee_id === employeeId);
    if (action === 'APPROVED' && !validEmployee) return;
    if (action !== 'refresh' && !window.confirm(action === 'APPROVED'
      ? `Duyệt chuyển ca của ${selected.requesting_employee_name} cho ${validEmployee!.full_name}?\n${dateLabel(selected.original_assignment.work_date)} · ${shiftLabel(selected.shift)}\nLịch làm sẽ được cập nhật khi duyệt thành công.`
      : `Từ chối yêu cầu của ${selected.requesting_employee_name}?\n${dateLabel(selected.original_assignment.work_date)} · ${shiftLabel(selected.shift)}\n${reason.trim() ? `Lý do: ${reason.trim()}` : 'Không nhập lý do.'}`)) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'refresh') {
        const result = await api.refresh(selected.id);
        setMessage(`Đã đối soát: ${result.invitations_created} lời mời mới, ${result.accepted_count} người đồng ý còn khả dụng.${result.warning ? ' Hiện không có người thay khả dụng.' : ''}`);
      } else {
        const result = await api.decide(selected.id, action, action === 'APPROVED' ? employeeId : undefined, action === 'REJECTED' ? reason : undefined);
        setMessage(result.decision === 'APPROVED' ? `Đã duyệt và cập nhật lịch làm.${result.new_assignment_id ? ` Mã phân công mới: ${result.new_assignment_id}` : ''}` : 'Đã từ chối yêu cầu.');
        setReason('');
      }
    } catch (e) { setError(errorMessage(e)); handleAuth(e); }
    finally { await load(); submitting.current = false; setBusy(false); }
  };
  const visible = requests?.filter(r => !filter || r.status === filter);
  return <section className="sc-page">
    <div className="sc-heading"><div><h2>Xử lý yêu cầu đổi ca</h2><p>Yêu cầu thuộc chi nhánh của bạn · Giờ Việt Nam</p></div><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''} />Tải lại</button></div>
    {message && <p role="status" className="sc-alert sc-success">{message}</p>}
    {error && <p role="alert" className="sc-alert sc-error">{error} Hãy kiểm tra dữ liệu đã tải lại trước khi thao tác tiếp.</p>}
    {loadError && <p role="alert" className="sc-alert sc-error">{loadError} <button className="btn btn-outline btn-sm" disabled={loading || busy} onClick={() => void load()}>Thử tải lại</button></p>}
    <label className="sc-filter">Trạng thái<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả yêu cầu</option>{['SEARCHING', 'PENDING', 'APPROVED', 'REJECTED'].map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
    {loading && <p role="status">Đang tải yêu cầu…</p>}
    {visible && (!visible.length ? <div className="card sc-empty">Không có yêu cầu phù hợp.</div> : <div className="card sc-table-wrap" tabIndex={0} aria-label="Yêu cầu đổi ca trong chi nhánh"><table><thead><tr><th scope="col">Nhân viên</th><th scope="col">Ngày / ca</th><th scope="col">Trạng thái</th><th scope="col">Đồng ý khả dụng</th><th scope="col">Cảnh báo</th><th scope="col">Chi tiết</th></tr></thead><tbody>{visible.map(r => <tr key={r.id}><td>{r.requesting_employee_name}<small>{timestamp(r.created_at)}</small></td><td>{dateLabel(r.original_assignment.work_date)}<small>{shiftLabel(r.shift)}</small></td><td><span className={`badge ${r.status === 'APPROVED' ? 'badge-green' : r.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'}`}>{statusLabel[r.status]}</span></td><td>{openRequest(r) ? acceptedCandidates(r, now).length : '—'}</td><td>{r.warning ? 'Không có người thay khả dụng' : '—'}</td><td><button className="btn btn-outline btn-sm" aria-expanded={selectedId === r.id} onClick={() => { setSelectedId(selectedId === r.id ? '' : r.id); setEmployeeId(''); setReason(''); }} disabled={busy}>Xem chi tiết</button></td></tr>)}</tbody></table></div>)}
    {selected && <article className="card sc-selected"><h3>Yêu cầu của {selected.requesting_employee_name}</h3><ShiftChangeRequestDetails request={selected} now={now}>
      {openRequest(selected) && <fieldset className="sc-form" disabled={busy || loading}><legend>Quyết định của quản lý</legend>
        <label>Người đã đồng ý và còn đủ điều kiện<select value={selectedEmployee ? employeeId : ''} onChange={e => setEmployeeId(e.target.value)}><option value="">Chọn một người thay</option>{candidates.map((i, index) => <option key={i.id} value={i.target_employee_id}>{i.full_name}{candidates.filter(x => x.full_name === i.full_name).length > 1 ? ` (${index + 1})` : ''}</option>)}</select></label>
        {!candidates.length && <p className="sc-hint">Chưa có người đồng ý còn đủ điều kiện để duyệt, lịch không còn hợp lệ hoặc ca đã bắt đầu.</p>}
        <label>Lý do từ chối (tùy chọn)<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="sc-actions"><button className="btn btn-primary" disabled={!selectedEmployee} onClick={() => void act('APPROVED')}>Duyệt người đã chọn</button><button className="btn btn-outline sc-danger" onClick={() => void act('REJECTED')}>Từ chối yêu cầu</button><button className="btn btn-outline" onClick={() => void act('refresh')}>Đối soát và tìm thêm</button></div>
        <p className="sc-hint">Đối soát có thể gửi thêm lời mời. Duyệt sẽ kiểm tra lại điều kiện và cập nhật lịch trong cùng giao dịch.</p>
      </fieldset>}
    </ShiftChangeRequestDetails></article>}
  </section>;
}
