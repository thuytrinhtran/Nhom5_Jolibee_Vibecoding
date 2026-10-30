import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel, latestSchedule, scheduleCalendarRows, scheduleRows, statusLabel, weekLabel } from '../../services/scheduling.view';
import type { RegistrationSummary, SavedSchedule, SchedulingContext, SchedulingPeriod } from '../../types/scheduling';
import './ManagerSchedule.css';
import { MockDraftEditor } from './MockDraftEditor';
import { ScheduleReviewPanel } from './ScheduleReviewPanel';
import { RegistrationSummaryPanel } from './RegistrationSummaryPanel';
import { ScheduleAIPanel } from './ScheduleAIPanel';

export function ScheduleTable({ context, saved, summary }: { context: SchedulingContext; saved: SavedSchedule | null;summary?:RegistrationSummary|null }) {
  const rows = scheduleCalendarRows(context, saved);
  const employeeName = (id: string) => context.employees.find(e => e.id === id)?.full_name || `Nhân viên ${id}`;
  return <div className="schedule-table-scroll schedule-calendar-scroll" tabIndex={0} role="region" aria-label="Bảng lịch làm việc theo ngày và ca">
    <table className="schedule-table">
      <caption>{saved ? 'Phân công đã lưu trong lịch làm việc' : 'Nhu cầu nhân sự của tuần — chưa có phân công'}</caption>
      <thead><tr><th scope="col">Ngày làm</th><th scope="col">Ca làm</th><th scope="col">Bộ phận</th><th scope="col">Nhân viên được phân công</th><th scope="col">Yêu cầu</th><th scope="col">Đã xếp</th><th scope="col">Còn thiếu</th></tr></thead>
      <tbody>{rows.map(row => {
        const shift = context.shifts.find(s => s.id === row.shift_id);
        const knownRegistrations=summary?.period.id===context.period.id&&summary.branch.id===context.period.branch_id&&(!context.source||context.source===summary.source);
        const registered=knownRegistrations?summary.rows.some(r=>r.work_date===row.work_date&&r.shift_id===row.shift_id&&r.registered_count>0):null;
        return <tr key={row.key} data-work-date={row.work_date} data-shift-id={row.shift_id} className={saved && (row.missing_count??0) > 0 ? 'schedule-row-short' : undefined}>
          <th scope="row">{dateLabel(row.work_date)}</th>
          <td><strong>{shift?.name || row.shift_id}</strong>{shift && <small>{shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}{shift.end_time < shift.start_time ? ' (hôm sau)' : ''}</small>}{registered===false&&<small>Chưa có nhân viên đăng ký</small>}</td>
          <td>{context.departments.find(d => d.id === row.department_id)?.name || row.department_id}{row.required_skill_name && <small>Kỹ năng: {row.required_skill_name}</small>}</td>
          <td>{row.assignments.length ? <ul className="schedule-employees">{row.assignments.map(a => <li key={a.id || a.employee_id}>{employeeName(a.employee_id)}</li>)}</ul> : <span className="schedule-muted">Chưa phân công</span>}</td>
          <td>{row.required_count??(saved&&row.current_required_count!==null?'Chưa có nhu cầu trong phiên bản này':'Chưa nhập nhu cầu')}{saved&&row.required_count===null&&row.current_required_count!==null&&<small>Nhu cầu hiện tại: {row.current_required_count}. Cần tạo phiên bản mới để sử dụng.</small>}</td><td>{saved ? row.assigned_count : '—'}</td>
          <td>{row.missing_count===null?<span className="schedule-muted">Chưa thể đánh giá</span>:saved ? <span className={`badge ${row.missing_count ? 'badge-yellow' : 'badge-green'}`}>{row.missing_count ? `Thiếu ${row.missing_count}` : 'Đủ người'}</span> : '—'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function ManagerSchedule() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [periods, setPeriods] = useState<SchedulingPeriod[]>([]);
  const [periodId, setPeriodId] = useState(params.get('period_id') || '');
  const [context, setContext] = useState<SchedulingContext | null>(null);
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [registrationSummary,setRegistrationSummary]=useState<RegistrationSummary|null>(null);
  const sequence = useRef(0);
  const submitting = useRef(false);
  const selected = periods.find(p => p.id === periodId);
  const busy = loadingPeriods || loadingWeek || generating;
  const fail = (err: unknown) => err instanceof Error ? err.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';

  useEffect(() => {
    let active = true;
    setLoadingPeriods(true); setPeriods([]); setError(''); setNotice(''); setContext(null); setSaved(null);
    if (!user?.branch_id) { setLoadingPeriods(false); return; }
    schedulingService.periods().then(data => {
      if (!active) return;
      setPeriods(data);
      setPeriodId(current => data.some(p => p.id === current) ? current : (data.find(p => p.status === 'CLOSED') || data[0])?.id || '');
    }).catch(err => { if (active) setError(fail(err)); })
      .finally(() => { if (active) setLoadingPeriods(false); });
    return () => { active = false; };
  }, [user?.branch_id, reload]);

  useEffect(() => {
    const request = ++sequence.current;
    if (loadingPeriods || !selected) { setLoadingWeek(false); return; }
    setLoadingWeek(true); setError(''); setNotice(''); setContext(null); setSaved(null);
    const load = async () => {
      const data = await schedulingService.context(selected.id);
      const existing = latestSchedule(selected);
      const persisted = existing ? await schedulingService.read(existing.id) : null;
      if (sequence.current !== request) return;
      setContext(data); setSaved(persisted);
    };
    void load().catch(err => { if (sequence.current === request) setError(fail(err)); })
      .finally(() => { if (sequence.current === request) setLoadingWeek(false); });
    return () => { sequence.current++; };
  }, [selected, loadingPeriods]);

  const generate = async () => {
    if (!selected || !context || busy || submitting.current || (context.source !== 'mock' && (saved || selected.schedules.length))) return;
    submitting.current = true; setGenerating(true); setError(''); setNotice('');
    const request = ++sequence.current;
    let createdId: string | null = null;
    try {
      const created = await schedulingService.generate(selected.id,context.source==='mock'&&saved?{regenerate:true,expected_version:saved.schedule.version}:undefined);
      createdId = created.id;
      const persisted = await schedulingService.read(created.id);
      if (sequence.current !== request) return;
      setSaved(persisted);
      setNotice(context.source==='mock'?'Đã tạo và đọc lại lịch dự kiến với Dữ liệu thử nghiệm (chỉ lưu bộ nhớ).':created.reused ? 'Đã đọc lại lịch dự kiến đã lưu của tuần này.' : 'Đã lưu và đọc lại lịch dự kiến. Quản lý ca có thể xem xét phân công bên dưới.');
    } catch (err) {
      if (sequence.current !== request) return;
      setError(createdId ? `Lịch đã được lưu nhưng chưa đọc lại thành công. Hãy bấm “Tải lại tuần”. ${fail(err)}` : fail(err));
      if (err instanceof ApiError && err.code === 'SCHEDULE_EXISTS') setNotice('Tuần đã có lịch. Hãy tải lại tuần để đọc phiên bản hiện có.');
    } finally { submitting.current = false; if (sequence.current === request) setGenerating(false); }
  };
  const rows = context ? scheduleRows(context, saved) : [];
  const required = rows.reduce((sum, row) => sum + row.required_count, 0);
  const assigned = rows.reduce((sum, row) => sum + row.assigned_count, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing_count, 0);
  const existing = !!saved || !!selected?.schedules.length;
  const canGenerate = !!context && selected?.status === 'CLOSED' && !!context.requirements.length && (!existing || context.source==='mock') && !busy;

  return <section className="manager-schedule" aria-busy={busy}>
    <header className="dashboard-greeting"><h2>Lập lịch làm việc</h2><p>Tạo lịch dự kiến cho {user?.branch_name || 'chi nhánh phụ trách'} từ đăng ký ca và nhu cầu nhân sự.</p></header>
    <div className="card schedule-controls">
      <div className="schedule-week-field"><label htmlFor="schedule-week"><CalendarDays size={17} aria-hidden="true" />Tuần cần lập lịch</label>
        <select id="schedule-week" value={periodId} disabled={busy || !periods.length} onChange={e => {
          setPeriodId(e.target.value); setParams({ period_id: e.target.value }, { replace: true }); setContext(null); setSaved(null); setError(''); setNotice('');
        }}><option value="" disabled>Chọn tuần làm việc</option>{periods.map(p => <option key={p.id} value={p.id}>{weekLabel(p)} · {statusLabel(p.status)}</option>)}</select>
      </div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setReload(n => n + 1)}><RefreshCw size={16} aria-hidden="true" />Tải lại tuần</button>
      <button type="button" className="btn btn-primary" disabled={!canGenerate} onClick={() => void generate()}>{generating ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Wand2 size={17} aria-hidden="true" />}{generating ? 'Đang tạo và lưu lịch…' : context?.source==='mock'&&saved?'Tạo lại lịch dự kiến':'Tạo lịch dự kiến'}</button>
    </div>
    {context?.source === 'mock' && <div className="schedule-alert" role="status">Dữ liệu thử nghiệm — lịch chỉ lưu trong bộ nhớ backend, không gửi lên Supabase. {context.test_rules?.max_shifts_per_day?`Giới hạn ${context.test_rules.max_shifts_per_day} ca/ngày là cấu hình kiểm thử.`:'Không áp đặt giới hạn ca/ngày khi chưa cấu hình.'}</div>}
    {!loadingPeriods && <RegistrationSummaryPanel periodId={selected?.id || ''} refreshKey={reload} context={context} onSummary={setRegistrationSummary}/>}
    <p className="schedule-muted">Lịch mới được lưu ở trạng thái dự kiến để quản lý xem xét. Việc phê duyệt và công bố thuộc các bước tiếp theo.</p>
    {!user?.branch_id && <div className="schedule-alert" role="alert">Tài khoản quản lý chưa được phân công chi nhánh.</div>}
    {error && <div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>}
    {notice && <div className="schedule-alert schedule-alert-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span></div>}
    {(loadingPeriods || loadingWeek) && <div className="schedule-empty" role="status"><Loader2 className="spin" size={24} aria-hidden="true" />Đang đọc dữ liệu tuần và lịch đã lưu…</div>}
    {!loadingPeriods && !periods.length && !error && user?.branch_id && <div className="card schedule-empty"><CalendarDays size={30} aria-hidden="true" /><h3>Chưa có tuần đăng ký</h3><p>Nguồn dữ liệu đang chọn chưa có đợt cho chi nhánh. Có thể bật chế độ dữ liệu thử nghiệm trong development để thử TV3 mà không chờ TV2.</p></div>}
    {context && !loadingWeek && <>
      <div className="schedule-heading"><h3>{weekLabel(context.period)}</h3><span className={`badge ${saved?.schedule.status === 'DRAFT' ? 'badge-yellow' : 'badge-slate'}`}>{statusLabel(saved?.schedule.status || context.period.status)}</span></div>
      {!existing && selected?.status !== 'CLOSED' && <div className="schedule-alert">Cần đóng đợt đăng ký trước khi tạo lịch dự kiến.</div>}
      {!context.requirements.length && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa khai báo nhu cầu nhân sự cho tuần này. Cần bổ sung nhu cầu trước khi tạo lịch.</span></div>}
      {context.valid_registration_count === 0 && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa có đăng ký ca hợp lệ. Nếu tạo lịch, các vị trí cần người sẽ được ghi nhận còn thiếu.</span></div>}
      <div className="dashboard-metrics">
        {[['Nhân sự yêu cầu', required], ['Đã phân công', saved ? assigned : '—'], ['Còn thiếu', saved ? missing : '—'], ['Đăng ký ca hợp lệ', context.valid_registration_count]].map(([label, value]) => <div className="dashboard-metric" key={label}><div className="dashboard-metric-heading">{label}</div><div className="schedule-metric-value">{value}</div></div>)}
      </div>
      {saved && <p className="schedule-muted">Mã lịch: <code>{saved.schedule.id}</code> · Phiên bản {saved.schedule.version}</p>}
      {saved?.demand_changed&&<div className="schedule-alert" role="status">Nhu cầu đã thay đổi so với lịch đang xem. Bấm Tạo lại lịch dự kiến để dùng nhu cầu mới.</div>}
      {saved && missing > 0 && <div className="schedule-alert" role="status"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa đủ nhân viên phù hợp: thiếu {missing} lượt phân công ở {rows.filter(r => r.missing_count > 0).length} ca/bộ phận. Quản lý cần xem xét và bổ sung nhân sự trước khi trình duyệt.</span></div>}
      {saved && saved.generation_snapshot?.new_employee_count_threshold == null && <div className="schedule-alert">Chưa đủ dữ liệu đánh giá: chưa có ngưỡng cảnh báo NEW trong kết quả lịch.</div>}
      {saved?.generation_snapshot?.coverage?.some(r => r.warning) && <div className="schedule-alert">Có ca nhiều nhân viên mới và không có Crew Training theo ngưỡng đã cấu hình. Vui lòng kiểm tra cơ cấu nhân sự.</div>}
      {(!!context.shifts.length||!!rows.length||!!saved?.assignments.length) && <div className="card schedule-table-card"><ScheduleTable context={context} saved={saved} summary={registrationSummary}/></div>}
      {saved && !rows.length && <div className="schedule-alert">Lịch này chưa có dữ liệu nhu cầu để đối chiếu; các ca vẫn được hiển thị và không được coi là nhu cầu 0.</div>}
      {saved?.source==='mock'&&context.source==='mock'&&<MockDraftEditor key={saved.schedule.id} context={context} saved={saved} onSaved={value=>{if(value.schedule.period_id===selected?.id){setSaved(value);setNotice('Đã kiểm tra và lưu phiên bản DRAFT thử nghiệm mới trong bộ nhớ.');}}}/>}
      {saved&&<ScheduleReviewPanel key={`${saved.schedule.id}/${saved.schedule.version}`} saved={saved}/>}
      {saved&&<ScheduleAIPanel saved={saved} employees={context.employees}/>}
      <p className="schedule-muted">Nhu cầu nhân sự không bao gồm Crew Leader. Lịch Crew Leader do quản lý thiết lập riêng.</p>
    </>}
    {error && <Link className="schedule-help-link" to="/manager">Về tổng quan quản lý</Link>}
  </section>;
}
