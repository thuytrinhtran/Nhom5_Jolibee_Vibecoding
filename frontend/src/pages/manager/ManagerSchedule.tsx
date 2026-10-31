import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel, latestSchedule, scheduleCalendarRows, scheduleRows, statusLabel, weekLabel } from '../../services/scheduling.view';
import type { RegistrationSummary, SavedSchedule, SchedulingContext, SchedulingPeriod, SchedulePreview, ScheduleAssignment } from '../../types/scheduling';
import './ManagerSchedule.css';
import { MockDraftEditor } from './MockDraftEditor';
import { ScheduleReviewPanel } from './ScheduleReviewPanel';
import { RegistrationSummaryPanel } from './RegistrationSummaryPanel';
import { ScheduleAIPanel } from './ScheduleAIPanel';

export function ScheduleTable({ context, saved, summary, preview }: { context: SchedulingContext; saved: SavedSchedule | null;summary?:RegistrationSummary|null;preview?:SchedulePreview|null }) {
  const display=preview?{assignments:preview.result.assignments,generation_snapshot:preview.result}:saved;
  const hasPlan=!!display;
  const rows = scheduleCalendarRows(context, display);
  const employeeName = (id: string) => context.employees.find(e => e.id === id)?.full_name || `Nhân viên ${id}`;
  // Group the existing calendar view, including empty and historical cells.
  // Counts are assignment occurrences, never distinct employees.
  const days = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = days.get(row.work_date) ?? [];
    day.push(row); days.set(row.work_date, day);
  }
  const knownRegistrations = summary?.period.id === context.period.id && summary.branch.id === context.period.branch_id && (!context.source || context.source === summary.source);
  return <section className="schedule-calendar" aria-label="Bảng lịch làm việc theo ngày và ca">
    <header className="schedule-calendar-heading">
      <div><h4>{preview ? 'Lịch dự kiến — chưa lưu' : hasPlan ? 'Phân công đã lưu trong lịch làm việc' : 'Nhu cầu nhân sự của tuần — chưa có phân công'}</h4>
        <p>Mở từng ngày để xem phân công. Đã xếp / Cần dùng nhu cầu của phiên bản lịch; tổng theo ngày tính theo lượt phân công.</p></div>
      {(context.source === 'mock' || saved?.source === 'mock' || saved?.is_mock) && <span className="badge badge-slate">Dữ liệu thử nghiệm · MOCK</span>}
    </header>
    {[...days].map(([date, dayRows], index) => {
      const assigned = dayRows.reduce((total, row) => total + row.assigned_count, 0);
      const missing = dayRows.reduce((total, row) => total + (row.missing_count ?? 0), 0);
      const unknown = dayRows.filter(row => row.required_count === null).length;
      const shiftIds = [...new Set(dayRows.map(row => row.shift_id))];
      return <details className="schedule-day" key={`${context.period.id}/${saved?.schedule.id ?? preview?.input_revision ?? 'unsaved'}/${date}`} open={index === 0}>
        <summary><ChevronRight className="schedule-day-chevron" size={16} aria-hidden="true" />
          <strong className="schedule-day-date">{dateLabel(date)}</strong>
          <span className="schedule-day-totals">
            <span><b>{hasPlan ? assigned : '—'}</b> lượt đã xếp</span>
            <span className={hasPlan && missing > 0 ? 'schedule-day-missing' : undefined}>{!hasPlan ? 'Chưa có phân công' : unknown === dayRows.length ? 'Còn thiếu: chưa xác định' : <><b>{missing}</b> lượt còn thiếu{unknown > 0 ? ' đã biết' : ''}</>}</span>
            {unknown > 0 && <span className="schedule-day-unknown">{unknown} ô chưa có nhu cầu</span>}
          </span>
        </summary>
        <div className="schedule-day-body">
          {hasPlan && unknown > 0 && unknown < dayRows.length && <p className="schedule-muted schedule-day-note">Tổng thiếu chưa đầy đủ: còn ô chưa có nhu cầu trong phiên bản này.</p>}
          {shiftIds.map(shiftId => {
            const shift = context.shifts.find(s => s.id === shiftId);
            const registered = knownRegistrations ? summary.rows.some(r => r.work_date === date && r.shift_id === shiftId && r.registered_count > 0) : null;
            return <section className="schedule-shift" key={shiftId} aria-label={`${shift?.name || shiftId} · ${dateLabel(date)}`}>
              <header className="schedule-shift-heading"><h5>{shift?.name || shiftId}</h5>
                {shift && <span>{shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}{shift.end_time < shift.start_time ? ' (hôm sau)' : ''}</span>}
                {registered === false && <small>Chưa có nhân viên đăng ký</small>}
              </header>
              <table className="schedule-shift-table">
                <caption className="schedule-visually-hidden">{shift?.name || shiftId} · {dateLabel(date)}</caption>
                <thead><tr><th scope="col">Bộ phận</th><th scope="col">Nhân viên được phân công</th><th scope="col">Đã xếp / Cần</th><th scope="col">Trạng thái</th></tr></thead>
                <tbody>{dayRows.filter(row => row.shift_id === shiftId).map(row => <tr key={row.key} data-work-date={row.work_date} data-shift-id={row.shift_id}>
                  <th scope="row">{context.departments.find(d => d.id === row.department_id)?.name || row.department_id}{row.required_skill_name && <small>Kỹ năng: {row.required_skill_name}</small>}</th>
                  <td data-label="Nhân viên được phân công">{row.assignments.length ? <ul className="schedule-employee-chips">{row.assignments.map(a => <li key={a.id || a.employee_id}>{employeeName(a.employee_id)}</li>)}</ul> : <span className="schedule-muted">Chưa phân công</span>}</td>
                  <td data-label="Đã xếp / Cần"><span className="schedule-assignment-ratio" aria-label={`Đã xếp ${hasPlan ? row.assigned_count : 'chưa xác định'}, cần ${row.required_count ?? 'chưa xác định'}`}>{hasPlan ? row.assigned_count : '—'}<span> / </span>{row.required_count ?? '—'}</span>
                    {row.required_count === null && <small>{hasPlan && row.current_required_count !== null ? 'Chưa có nhu cầu trong phiên bản này' : 'Chưa nhập nhu cầu'}</small>}
                    {hasPlan && row.required_count === null && row.current_required_count !== null && <small>Nhu cầu hiện tại: {row.current_required_count}. Cần tạo phiên bản mới để sử dụng.</small>}
                  </td>
                  <td data-label="Trạng thái">{row.missing_count === null ? <span className="schedule-muted">Chưa thể đánh giá</span> : hasPlan ? <span className={`badge ${row.missing_count ? 'badge-yellow' : 'badge-green'}`}>{row.missing_count ? `Thiếu ${row.missing_count}` : 'Đủ người'}</span> : <span className="schedule-muted">Chưa có phân công</span>}</td>
                </tr>)}</tbody>
              </table>
            </section>;
          })}
        </div>
      </details>;
    })}
  </section>;
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
  const [preview,setPreview]=useState<SchedulePreview|null>(null);
  const [edited,setEdited]=useState<ScheduleAssignment[]>([]);
  const [editDirty,setEditDirty]=useState(false);
  const [needId,setNeedId]=useState('');
  const [employeeId,setEmployeeId]=useState('');
  const [saving,setSaving]=useState(false);
  const sequence = useRef(0);
  const submitting = useRef(false);
  const saveAttempt=useRef<{key:string;id:string}|null>(null);
  const selected = periods.find(p => p.id === periodId);
  const busy = loadingPeriods || loadingWeek || generating || saving;
  const fail = (err: unknown) => err instanceof ApiError || err instanceof Error ? err.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';

  useEffect(() => {
    let active = true;
    setLoadingPeriods(true); setPeriods([]); setError(''); setNotice(''); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false);
    if (!user?.branch_id) { setLoadingPeriods(false); return; }
    schedulingService.periods().then(data => {
      if (!active) return;
      setPeriods(data);
      setPeriodId(current => data.some(p => p.id === current) ? current : (data.find(p => p.status === 'CLOSED') || data[0])?.id || '');
    }).catch(err => { if (active) setError(fail(err)); })
      .finally(() => { if (active) setLoadingPeriods(false); });
    return () => { active = false; };
  }, [user?.id, user?.branch_id, reload]);

  useEffect(() => {
    const request = ++sequence.current;
    if (loadingPeriods || !selected) { setLoadingWeek(false); return; }
    setLoadingWeek(true); setError(''); setNotice(''); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false);
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

  const plain=(a:ScheduleAssignment)=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
  const generate = async (review=false,openSaved=false) => {
    if (!selected || !context || busy || submitting.current || (review&&!preview)) return;
    submitting.current=true;setGenerating(true);setError('');setNotice('');
    const request=++sequence.current;
    try {
      const target=preview?.edit_target??(saved?.schedule.status==='DRAFT'&&saved.source!=='mock'?{id:saved.schedule.id,version:saved.schedule.version}:null);
      const value=await schedulingService.preview(selected.id,target||review||openSaved?{...(target?{schedule_id:target.id,expected_version:target.version}:{}),...(review?{input_revision:preview!.input_revision,assignments:edited.map(plain)}:{}),...(openSaved?{use_saved_assignments:true as const}:{})}:undefined);
      if(sequence.current!==request)return;
      if(value.kind!=='preview'||value.persisted!==false||value.period.id!==selected.id||value.period.branch_id!==user?.branch_id)throw new Error('Invalid preview response');
      setPreview(value);setContext(value.context);setEdited(value.result.assignments.map(plain));setEditDirty(false);setNeedId(value.context.requirements[0]?.id||'');setEmployeeId('');
      if(review)setNotice('Đã kiểm tra và xác nhận phương án điều chỉnh. Bảng lịch và chỉ số đã được cập nhật; lịch chưa được lưu.');
    }catch(err){if(sequence.current===request){setError(err instanceof ApiError&&err.code==='DEMAND_EXCEEDED'?'Phân công vượt nhu cầu. Vui lòng giảm số nhân viên ở ca được đánh dấu.':fail(err));if(err instanceof ApiError&&err.code==='PREVIEW_STALE'){setPreview(null);setEdited([]);setEditDirty(false);}}}
    finally{submitting.current=false;if(sequence.current===request)setGenerating(false);}
  };
  const savePreview=async()=>{
    if(!selected||!preview||editDirty||busy||submitting.current||!preview.persistence.enabled)return;
    submitting.current=true;setSaving(true);setError('');setNotice('');const request=++sequence.current;let written=false;
    try{
      const assignments=preview.result.assignments.map(plain);
      const key=JSON.stringify({period:selected.id,revision:preview.input_revision,assignments,target:preview.edit_target});
      if(saveAttempt.current?.key!==key)saveAttempt.current={key,id:crypto.randomUUID()};
      const result=await schedulingService.savePreview(selected.id,{input_revision:preview.input_revision,assignments,request_id:saveAttempt.current!.id},preview.edit_target);written=true;
      const persisted=await schedulingService.read(result.id);
      if(sequence.current!==request)return;
      if(persisted.schedule.id!==result.id||persisted.schedule.period_id!==selected.id)throw new Error('Phản hồi lịch không khớp tuần đang chọn.');
      setSaved(persisted);setPreview(null);setEdited([]);setEditDirty(false);saveAttempt.current=null;setNotice('Đã lưu DRAFT và đọc lại dữ liệu.');
    }catch(err){if(sequence.current===request)setError(`${written?'Đã lưu DRAFT nhưng chưa đọc lại được. Hãy tải lại tuần hoặc thử lại cùng yêu cầu. ':''}${fail(err)}`);}
    finally{submitting.current=false;if(sequence.current===request)setSaving(false);}
  };
  const displayed=preview?{assignments:preview.result.assignments,generation_snapshot:preview.result}:saved;
  const rows = context ? scheduleRows(context, displayed) : [];
  const required = rows.reduce((sum, row) => sum + row.required_count, 0);
  const assigned = rows.reduce((sum, row) => sum + row.assigned_count, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing_count, 0);
  const existing = !!saved || !!selected?.schedules.length;
  const canGenerate = !!context && selected?.status === 'CLOSED' && !!context.requirements.length  && !busy;

  return <section className="manager-schedule" aria-busy={busy}>
    <header className="dashboard-greeting"><h2>Lập lịch làm việc</h2><p>Tạo lịch dự kiến cho {user?.branch_name || 'chi nhánh phụ trách'} từ đăng ký ca và nhu cầu nhân sự.</p></header>
    <div className="card schedule-controls">
      <div className="schedule-week-field"><label htmlFor="schedule-week"><CalendarDays size={17} aria-hidden="true" />Tuần cần lập lịch</label>
        <select id="schedule-week" value={periodId} disabled={busy || !periods.length} onChange={e => {
          setPeriodId(e.target.value); setParams({ period_id: e.target.value }, { replace: true }); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false); setError(''); setNotice('');
        }}><option value="" disabled>Chọn tuần làm việc</option>{periods.map(p => <option key={p.id} value={p.id}>{weekLabel(p)} · {statusLabel(p.status)}</option>)}</select>
      </div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setReload(n => n + 1)}><RefreshCw size={16} aria-hidden="true" />Tải lại tuần</button>
      <button type="button" className="btn btn-primary" disabled={!canGenerate} onClick={() => void generate()}>{generating ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Wand2 size={17} aria-hidden="true" />}{generating ? 'Đang kiểm tra phương án…' : preview?'Tạo lại phương án':'Tạo lịch dự kiến'}</button>
    </div>
    {context?.source === 'mock' && <div className="schedule-info" role="status">Dữ liệu thử nghiệm — lịch chỉ lưu trong bộ nhớ backend, không gửi lên Supabase. {context.test_rules?.max_shifts_per_day?`Giới hạn ${context.test_rules.max_shifts_per_day} ca/ngày là cấu hình kiểm thử.`:'Không áp đặt giới hạn ca/ngày khi chưa cấu hình.'}</div>}
    {!loadingPeriods && <RegistrationSummaryPanel periodId={selected?.id || ''} refreshKey={reload} context={context} onSummary={setRegistrationSummary}/>}
    <p className="schedule-muted">Tạo phương án để xem trước và điều chỉnh. Bản xem trước chưa được lưu và không thể gửi phê duyệt.</p>
    {!user?.branch_id && <div className="schedule-alert" role="alert">Tài khoản quản lý chưa được phân công chi nhánh.</div>}
    {error && !preview && <div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>}
    {notice && !preview && <div className="schedule-alert schedule-alert-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span></div>}
    {(loadingPeriods || loadingWeek) && <div className="schedule-empty" role="status"><Loader2 className="spin" size={24} aria-hidden="true" />Đang đọc dữ liệu tuần và lịch đã lưu…</div>}
    {!loadingPeriods && !periods.length && !error && user?.branch_id && <div className="card schedule-empty"><CalendarDays size={30} aria-hidden="true" /><h3>Chưa có tuần đăng ký</h3><p>Nguồn dữ liệu đang chọn chưa có đợt cho chi nhánh. Có thể bật chế độ dữ liệu thử nghiệm trong development để thử TV3 mà không chờ TV2.</p></div>}
    {context && !loadingWeek && <>
      <div className="schedule-heading"><h3>{weekLabel(context.period)}</h3><span className={`badge ${saved?.schedule.status === 'DRAFT' ? 'badge-yellow' : 'badge-slate'}`}>{preview?'Lịch dự kiến — chưa lưu':statusLabel(saved?.schedule.status || context.period.status)}</span></div>
      {preview && <section className="card preview-editor" aria-label="Điều chỉnh lịch dự kiến" aria-busy={generating}>
        <header className="preview-editor-heading">
          <div><h3>Điều chỉnh lịch dự kiến</h3><p className="schedule-muted">Lịch dự kiến — chưa lưu. Chọn nhân viên rồi kiểm tra lại trước khi tiếp tục.</p></div>
          <span className={`badge ${generating||editDirty?'badge-yellow':error?'badge-slate':'badge-green'}`} role="status">{generating?'Đang kiểm tra':error?'Kiểm tra thất bại':editDirty?'Có thay đổi chưa kiểm tra':notice?'Kiểm tra thành công':'Đã được backend xác nhận'}</span>
        </header>
        <p className="schedule-muted">{editDirty?'Bảng lịch và chỉ số bên dưới vẫn là phương án đã xác nhận gần nhất.':'Phương án đã được kiểm tra; chưa lưu hoặc gửi phê duyệt.'}</p>
        <div className="preview-groups">
          {context.requirements.map(need=>{
            const members=edited.map((assignment,index)=>({assignment,index})).filter(({assignment:a})=>a.work_date===need.work_date&&a.shift_id===need.shift_id&&a.department_id===need.department_id);
            const shift=context.shifts.find(s=>s.id===need.shift_id);
            const department=context.departments.find(d=>d.id===need.department_id)?.name||need.department_id;
            const excess=members.length>need.required_count;
            return <section className={`preview-group${excess?' preview-group-excess':''}`} key={need.id} aria-label={`${dateLabel(need.work_date)} · ${shift?.name||need.shift_id} · ${department}`}>
              <header className="preview-group-heading"><div><h4>{dateLabel(need.work_date)}</h4><p>{shift?.name||need.shift_id} {shift&&<span>· {shift.start_time.slice(0,5)}–{shift.end_time.slice(0,5)}{shift.end_time<shift.start_time?' (hôm sau)':''}</span>} · {department}</p></div>
                <div className="preview-group-counts"><span>Nhu cầu <strong>{need.required_count}</strong></span><span>Đang chọn <strong>{members.length}</strong></span></div>
              </header>
              {excess&&<p className="preview-excess-note"><AlertTriangle size={16} aria-hidden="true"/>Vượt nhu cầu {members.length-need.required_count} người. Hãy bỏ bớt phân công.</p>}
              {members.length?members.map(({assignment:a,index})=><div className="preview-employee-row" key={index}>
                <label htmlFor={`preview-employee-${index}`}>Nhân viên {members.findIndex(m=>m.index===index)+1}</label>
                <select id={`preview-employee-${index}`} aria-label={`Nhân viên phân công ${index+1}`} disabled={busy} value={a.employee_id} onChange={e=>{setEdited(edited.map((row,i)=>i===index?{...row,employee_id:e.target.value}:row));setEditDirty(true);setError('');setNotice('');}}>
                  {context.employees.filter(e=>e.department_id===a.department_id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
                <button type="button" className="btn btn-outline preview-remove" disabled={busy} aria-label={`Bỏ phân công ${context.employees.find(e=>e.id===a.employee_id)?.full_name||a.employee_id}`} onClick={()=>{setEdited(edited.filter((_,i)=>i!==index));setEditDirty(true);setError('');setNotice('');}}>Bỏ phân công</button>
              </div>):<p className="preview-group-empty">Chưa chọn nhân viên cho vị trí này.</p>}
            </section>;
          })}
        </div>
        <section className="preview-add" aria-label="Thêm nhân viên">
          <h4>Thêm nhân viên</h4>
          <div className="preview-add-grid">
            <label htmlFor="preview-need">Vị trí cần người<select id="preview-need" disabled={busy} value={needId} onChange={e=>{setNeedId(e.target.value);setEmployeeId('');}}>{context.requirements.map(n=><option key={n.id} value={n.id}>{dateLabel(n.work_date)} · {context.shifts.find(s=>s.id===n.shift_id)?.name} · {context.departments.find(d=>d.id===n.department_id)?.name}</option>)}</select></label>
            <label htmlFor="preview-add-employee">Nhân viên<select id="preview-add-employee" disabled={busy} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Chọn nhân viên</option>{context.employees.filter(e=>e.department_id===context.requirements.find(n=>n.id===needId)?.department_id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
            <button type="button" className="btn btn-outline" disabled={busy||!employeeId||!needId} onClick={()=>{const n=context.requirements.find(n=>n.id===needId);if(n){setEdited([...edited,{employee_id:employeeId,work_date:n.work_date,shift_id:n.shift_id,department_id:n.department_id}]);setEditDirty(true);setError('');setNotice('');}}}>Thêm phân công</button>
          </div>
          <p className="schedule-muted">Cảnh báo chỉ hỗ trợ điều chỉnh. Hệ thống sẽ kiểm tra nguyện vọng và các ràng buộc khi xác nhận.</p>
        </section>
        <footer className="preview-review" aria-label="Kiểm tra phương án">
          <div className="preview-review-actions"><button type="button" className="btn btn-primary" disabled={busy||!editDirty} onClick={()=>void generate(true)}>{generating?<><Loader2 className="spin" size={16} aria-hidden="true"/>Đang kiểm tra…</>:'Kiểm tra lại phương án'}</button><button type="button" className="btn btn-outline" disabled={busy||editDirty||!preview.persistence.enabled} onClick={()=>void savePreview()}>{saving?'Đang lưu DRAFT…':'Lưu lịch dự kiến'}</button></div>
          {error&&<div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true"/><span>{error} Các chỉnh sửa được giữ lại; phương án đã xác nhận không thay đổi.</span></div>}
          {notice&&!editDirty&&<div className="schedule-alert schedule-alert-success" role="status"><CheckCircle2 size={18} aria-hidden="true"/><span>{notice}</span></div>}
          <p className="schedule-muted">{preview.persistence.reason}</p>
        </footer>
      </section>}
      {!existing && selected?.status !== 'CLOSED' && <div className="schedule-alert">Cần đóng đợt đăng ký trước khi tạo lịch dự kiến.</div>}
      {!context.requirements.length && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa khai báo nhu cầu nhân sự cho tuần này. Cần bổ sung nhu cầu trước khi tạo lịch.</span></div>}
      {context.valid_registration_count === 0 && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa có đăng ký ca hợp lệ. Nếu tạo lịch, các vị trí cần người sẽ được ghi nhận còn thiếu.</span></div>}
      <div className="dashboard-metrics">
        {[['Nhân sự yêu cầu', required], ['Đã phân công', displayed ? assigned : '—'], ['Còn thiếu', displayed ? missing : '—'], ['Đăng ký ca hợp lệ', context.valid_registration_count]].map(([label, value]) => <div className="dashboard-metric" key={label}><div className="dashboard-metric-heading">{label}</div><div className="schedule-metric-value">{value}</div></div>)}
      </div>
      {saved && !preview && <p className="schedule-muted">Mã lịch: <code>{saved.schedule.id}</code> · Phiên bản {saved.schedule.version}</p>}
      {saved&&!preview&&saved.source!=='mock'&&saved.schedule.status==='DRAFT'&&<button className="btn btn-outline" type="button" disabled={busy} onClick={()=>void generate(false,true)}>Chỉnh sửa DRAFT đã lưu</button>}
      {!preview&&saved?.demand_changed&&<div className="schedule-info schedule-demand-changed" role="status">Nhu cầu đã thay đổi so với lịch đang xem. Bấm Tạo lại lịch dự kiến để dùng nhu cầu mới.</div>}
      {saved && !preview && missing > 0 && <div className="schedule-info" role="status"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa đủ nhân viên phù hợp: thiếu {missing} lượt phân công ở {rows.filter(r => r.missing_count > 0).length} ca/bộ phận. Quản lý cần xem xét và bổ sung nhân sự trước khi trình duyệt.</span></div>}
      {(!!context.shifts.length||!!rows.length||!!saved?.assignments.length) && <div className="card schedule-table-card"><ScheduleTable context={context} saved={saved} preview={preview} summary={registrationSummary}/></div>}
      {saved && !preview && (saved.generation_snapshot?.new_employee_count_threshold == null || saved.generation_snapshot?.coverage?.some(r => r.warning)) && <details className="schedule-additional"><summary>Thông tin bổ sung · Cơ cấu nhân viên mới</summary>
        {saved.generation_snapshot?.new_employee_count_threshold == null && <p>Chưa đủ dữ liệu đánh giá: chưa có ngưỡng cảnh báo NEW trong kết quả lịch.</p>}
        {saved.generation_snapshot?.coverage?.some(r => r.warning) && <p>Có ca nhiều nhân viên mới và không có Crew Training theo ngưỡng đã cấu hình. Vui lòng kiểm tra cơ cấu nhân sự.</p>}
      </details>}
      {saved && !preview && !rows.length && <div className="schedule-alert">Lịch này chưa có dữ liệu nhu cầu để đối chiếu; các ca vẫn được hiển thị và không được coi là nhu cầu 0.</div>}
      {!preview&&saved?.source==='mock'&&context.source==='mock'&&<MockDraftEditor key={saved.schedule.id} context={context} saved={saved} onSaved={value=>{if(value.schedule.period_id===selected?.id){setSaved(value);setNotice('Đã kiểm tra và lưu phiên bản DRAFT thử nghiệm mới trong bộ nhớ.');}}}/>}
      {saved&&!preview&&<ScheduleReviewPanel key={`${saved.schedule.id}/${saved.schedule.version}`} saved={saved}/>}
      {saved&&!preview&&<ScheduleAIPanel saved={saved} employees={context.employees}/>}
      <p className="schedule-muted">Nhu cầu nhân sự không bao gồm Crew Leader. Lịch Crew Leader do quản lý thiết lập riêng.</p>
    </>}
    {error && <Link className="schedule-help-link" to="/manager">Về tổng quan quản lý</Link>}
  </section>;
}
