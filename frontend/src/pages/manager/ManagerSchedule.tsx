import { useUnsavedDemandGuard } from '../../services/staffing-demand.guard';
import { ScheduleAdjustmentIntent } from './ScheduleAdjustmentIntent';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel, latestSchedule, scheduleCalendarRows, scheduleRows, statusLabel, weekLabel } from '../../services/scheduling.view';
import type { RegistrationSummary, SavedSchedule, SchedulingContext, SchedulingPeriod, SchedulePreview, ScheduleAssignment, ScheduleRevisionRecord } from '../../types/scheduling';
import './ManagerSchedule.css';
import './ManagerPlanner.css';
import { MockDraftEditor } from './MockDraftEditor';
import { ScheduleReviewPanel } from './ScheduleReviewPanel';
import { RegistrationSummaryPanel } from './RegistrationSummaryPanel';
import { ScheduleAIPanel } from './ScheduleAIPanel';

export const scheduleCellKey=(a:{work_date:string;shift_id:string;department_id:string})=>`${a.work_date}/${a.shift_id}/${a.department_id}`;

// Match the server's group, never infer a predecessor from a version number alone.
export function revisionDetails(records:ScheduleRevisionRecord[],id:string,periodId:string,branchId:string) {
  const current=records.find(r=>r.id===id&&r.period_id===periodId&&r.branch_id===branchId);
  if(!current)return null;
  const predecessors=records.filter(r=>r.schedule_group_id===current.schedule_group_id&&r.period_id===periodId&&r.branch_id===branchId&&r.version<current.version).sort((a,b)=>b.version-a.version);
  const rejected=current.status==='NEEDS_REVISION'?current:predecessors.find(r=>r.status==='NEEDS_REVISION');
  const decision=rejected?.approvals.filter(a=>a.decision==='NEEDS_REVISION').sort((a,b)=>b.decided_at.localeCompare(a.decided_at))[0];
  return {current,previous:predecessors[0]??null,rejected,decision};
}

export function ScheduleRevisionContext({saved,periodId,branchId,preview}:{saved:SavedSchedule;periodId:string;branchId:string;preview:SchedulePreview|null}) {
  const [records,setRecords]=useState<ScheduleRevisionRecord[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const key=[saved.schedule.id,saved.schedule.version,periodId,branchId].join('/');
  const [loadedKey,setLoadedKey]=useState('');
  useEffect(()=>{
    let active=true;setRecords(null);setError('');setLoadedKey('');
    if(saved.source==='mock')return()=>{active=false;};
    schedulingService.revisionHistory().then(value=>{if(active){setRecords(value);setLoadedKey(key);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được yêu cầu chỉnh sửa.');});
    return()=>{active=false;};
  },[key,reload,saved.source]);
  const details=loadedKey===key&&records?revisionDetails(records,saved.schedule.id,periodId,branchId):null;
  return <section className="card summary-panel" aria-label="Phiên bản và yêu cầu chỉnh sửa">
    <h3>{saved.schedule.status==='NEEDS_REVISION'?'Giám sát yêu cầu chỉnh sửa':'Phiên bản lịch'}</h3>
    <p>Phiên bản đã lưu: <strong>{saved.schedule.version}</strong> · {statusLabel(saved.schedule.status)}</p>
    {preview?<p>Đang chỉnh sửa phương án chưa lưu từ phiên bản {preview.edit_target?.version??saved.schedule.version}. Số phiên bản DRAFT mới được xác nhận sau khi lưu.</p>:saved.schedule.status==='DRAFT'&&<p>Đang chỉnh sửa DRAFT phiên bản {saved.schedule.version}.</p>}
    {saved.source!=='mock'&&!records&&!error&&<p role="status">Đang tải yêu cầu chỉnh sửa…</p>}
    {error&&<div role="alert">Không tải được lý do yêu cầu chỉnh sửa: {error} <button type="button" className="btn btn-outline" onClick={()=>setReload(n=>n+1)}>Thử lại</button></div>}
    {details?.previous&&<p>Phiên bản trước: {details.previous.version} · {statusLabel(details.previous.status)}</p>}
    {details?.rejected&&<div className="schedule-alert" role="note"><div><strong>Yêu cầu chỉnh sửa phiên bản {details.rejected.version}</strong><p style={{whiteSpace:'pre-wrap'}}>Lý do của giám sát: {details.decision?.reason?.trim()||'API chưa trả lý do yêu cầu chỉnh sửa.'}</p></div></div>}
    {((records&&loadedKey===key&&!details)||(saved.schedule.status==='NEEDS_REVISION'&&details&&!details.rejected))&&<p role="status">API chưa trả thông tin yêu cầu chỉnh sửa của phiên bản này.</p>}
    {(saved.schedule.status==='NEEDS_REVISION'||details?.rejected)&&<p>Chỉnh sửa phân công → Kiểm tra lại phương án → Lưu DRAFT mới → Chuẩn bị dữ liệu gửi phê duyệt → Gửi giám sát duyệt lại. Phiên bản cũ và quyết định trước được giữ nguyên.</p>}
  </section>;
}
export function PlannerProgress({periodStatus,scheduleStatus,hasPreview}:{periodStatus?:string;scheduleStatus?:string;hasPreview:boolean}){
 const states=[periodStatus==='CLOSED'?'Đã đóng':periodStatus==='OPEN'?'Đang nhận':'Chưa xác nhận',hasPreview?'Đang dự kiến':scheduleStatus?'Đã có lịch':'Chưa xếp',scheduleStatus==='NEEDS_REVISION'?'Cần điều chỉnh':['APPROVED','PUBLISHED'].includes(scheduleStatus??'')?'Đã duyệt':scheduleStatus==='PENDING_APPROVAL'?'Chờ duyệt':'Chưa gửi',scheduleStatus==='PUBLISHED'?'Đã công bố':'Chưa công bố'];
 return <ol className="planner-progress" aria-label="Tiến trình lập lịch">{['Đăng ký ca','Xếp lịch','Phê duyệt','Công bố'].map((label,i)=><li key={label} className={(i===0&&periodStatus==='CLOSED')||(i===1&&!!scheduleStatus)||(i===2&&['APPROVED','PUBLISHED'].includes(scheduleStatus??''))||(i===3&&scheduleStatus==='PUBLISHED')?'is-complete':''}><span>{i+1}</span><div><strong>{label}</strong><small>{states[i]}</small></div></li>)}</ol>;
}
export function PlannerBoard({context,saved,preview,summary,edited,dirty=false,selectedCell,onSelect,day,onDay,children}:{context:SchedulingContext;saved:SavedSchedule|null;preview:SchedulePreview|null;summary?:RegistrationSummary|null;edited:ScheduleAssignment[];dirty?:boolean;selectedCell:string;onSelect:(key:string)=>void;day:string;onDay:(day:string)=>void;children?:ReactNode}){
 const [shift,setShift]=useState(''),[department,setDepartment]=useState('');
 const trigger=useRef<HTMLButtonElement|null>(null),panelRef=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(selectedCell&&panelRef.current)panelRef.current.querySelector<HTMLButtonElement>('[data-close-cell]')?.focus();},[selectedCell]);
 const plan=preview?{assignments:dirty?edited:preview.result.assignments,generation_snapshot:preview.result}:saved;
 const cells=scheduleCalendarRows(context,plan).map(c=>dirty?{...c,assigned_count:c.assignments.length,missing_count:null}:c);
 const visible=cells.filter(c=>(!day||c.work_date===day)&&(!shift||c.shift_id===shift)&&(!department||c.department_id===department));
 const dates=[...new Set(visible.map(c=>c.work_date))],groups=[...new Map(visible.map(c=>[`${c.shift_id}/${c.department_id}`,c])).values()];
 const chosen=cells.find(c=>c.key===selectedCell);
 const coverage=preview?.result.coverage??saved?.generation_snapshot?.coverage??[];
 const stats=preview?.result.employee_statistics??saved?.generation_snapshot?.employee_statistics??[];
 const registration=chosen&&summary?.period.id===context.period.id&&summary.branch.id===context.period.branch_id&&(!context.source||context.source===summary.source)?summary.rows.find(r=>scheduleCellKey(r)===chosen.key):undefined;
 const close=()=>{onSelect('');trigger.current?.focus();};
 const employee=(id:string)=>context.employees.find(e=>e.id===id)?.full_name??'Nhân viên ngoài danh mục hiện tại';
 return <div className={`planner-board-layout${chosen?' has-panel':''}`}><section className="card planner-board" aria-label="Bảng phân công theo ngày ca và bộ phận">
  <div className="planner-filters"><label>Ngày<select value={day} onChange={e=>{onDay(e.target.value);onSelect('');}}><option value="">Cả tuần</option>{[...new Set(cells.map(c=>c.work_date))].map(d=><option key={d} value={d}>{dateLabel(d)}</option>)}</select></label><label>Ca<select value={shift??''} onChange={e=>{setShift(e.target.value);onSelect('');}}><option value="">Tất cả ca</option>{[...new Set(cells.map(c=>c.shift_id))].map(id=><option key={id} value={id}>{context.shifts.find(s=>s.id===id)?.name??'Ca ngoài danh mục'}</option>)}</select></label><label>Bộ phận<select value={department??''} onChange={e=>{setDepartment(e.target.value);onSelect('');}}><option value="">Tất cả bộ phận</option>{[...new Set(cells.map(c=>c.department_id))].map(id=><option key={id} value={id}>{context.departments.find(d=>d.id===id)?.name??'Bộ phận ngoài danh mục'}</option>)}</select></label></div>
  <p className="planner-caption">{dirty?'Đang chọn / Cần · Chưa kiểm tra lại':'Đã xếp / Cần'} · Bấm ô để xem nhân viên{!preview&&saved?.schedule.status==='PUBLISHED'?' · Lịch đã công bố, chỉ xem':''}.</p>
  <div className="planner-matrix-scroll" tabIndex={0} aria-label="Bảng lịch tuần"><table className="planner-matrix"><thead><tr><th>Ca / Bộ phận</th>{dates.map(d=><th key={d} title={dateLabel(d)}>{new Intl.DateTimeFormat('vi-VN',{weekday:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(d+'T12:00:00+07:00'))}<small>{d.slice(8,10)}/{d.slice(5,7)}</small></th>)}</tr></thead><tbody>{groups.map(group=><tr key={`${group.shift_id}/${group.department_id}`}><th scope="row"><strong>{context.shifts.find(s=>s.id===group.shift_id)?.name??'Ca ngoài danh mục'}</strong><small>{context.departments.find(d=>d.id===group.department_id)?.name??'Bộ phận ngoài danh mục'}</small></th>{dates.map(d=>{const cell=visible.find(c=>c.work_date===d&&c.shift_id===group.shift_id&&c.department_id===group.department_id);if(!cell)return <td key={d}>—</td>;const c=coverage.find(c=>c.id===cell.requirement_id);return <td key={d}><button type="button" className={`planner-cell${cell.key===selectedCell?' is-selected':''}${!plan||cell.required_count===null?' is-unknown':dirty?' is-dirty':cell.missing_count||cell.assigned_count>cell.required_count?' is-short':''}`} aria-pressed={cell.key===selectedCell} aria-expanded={cell.key===selectedCell} aria-controls={cell.key===selectedCell?'planner-cell-detail':undefined} aria-label={`${dateLabel(d)} · ${context.shifts.find(s=>s.id===cell.shift_id)?.name??'Ca'} · ${context.departments.find(v=>v.id===cell.department_id)?.name??'Bộ phận'}: ${plan?cell.assigned_count:'chưa xếp'} / ${cell.required_count??'chưa có nhu cầu'}`} onClick={e=>{trigger.current=e.currentTarget;onSelect(cell.key);}}><strong>{plan?cell.assigned_count:'—'} / {cell.required_count??'—'}</strong><small>{dirty?'Chờ kiểm tra':cell.required_count===null?'Chưa có nhu cầu':!plan?'Chưa xếp':cell.required_count!==null&&cell.assigned_count>cell.required_count?`Vượt ${cell.assigned_count-cell.required_count}`:cell.missing_count?`Thiếu ${cell.missing_count}`:'Đủ người'}</small>{!dirty&&!!c?.missing_experienced_count&&<small className="planner-experience">Thiếu {c.missing_experienced_count} kinh nghiệm</small>}</button></td>;})}</tr>)}</tbody></table></div>
  {!groups.length&&<p>Không có ô lịch phù hợp bộ lọc.</p>}
 </section>{chosen&&<aside ref={panelRef} id="planner-cell-detail" className="card planner-cell-panel" aria-label="Chi tiết ô lịch" onKeyDown={e=>{if(e.key==='Escape')close();}}><header><div><h3>{dateLabel(chosen.work_date)}</h3><p>{context.shifts.find(s=>s.id===chosen.shift_id)?.name??'Ca ngoài danh mục'} · {context.departments.find(d=>d.id===chosen.department_id)?.name??'Bộ phận ngoài danh mục'}</p></div><button data-close-cell className="btn btn-outline" onClick={close} aria-label="Đóng chi tiết ô lịch">Đóng</button></header>
  {registration&&<p>Đăng ký: {registration.registered_count} · Đủ điều kiện: {registration.eligible_count??'chưa xác định'}</p>}
  {children??<><p>Đã xếp {plan?chosen.assigned_count:'—'} / Cần {chosen.required_count??'chưa có dữ liệu'}</p>{chosen.required_skill_name&&<p>Kỹ năng: {chosen.required_skill_name}</p>}{chosen.required_count===null&&chosen.current_required_count!==null&&<p>Nhu cầu hiện tại: {chosen.current_required_count}. Lịch đang xem chưa có nhu cầu này.</p>}{coverage.filter(c=>c.id===chosen.requirement_id&&c.experienced_target!==undefined).map(c=><p key={c.id}>Kinh nghiệm: {c.experienced_count}/{c.experienced_target}{!!c.existing_count&&` · ${c.existing_count} phân công có sẵn`}</p>)}{!chosen.assignments.length&&<p>Chưa có nhân viên trong ô này.</p>}<ul className="planner-members">{chosen.assignments.map((a,i)=><li key={a.id??`${a.employee_id}/${i}`}><details><summary>{employee(a.employee_id)}</summary><p>{({NEW:'Nhân viên mới',REGULAR:'Có kinh nghiệm',CREW_TRAINING:'Hướng dẫn viên',CREW_LEADER:'Trưởng ca'} as Record<string,string>)[context.employees.find(e=>e.id===a.employee_id)?.skill_level??'']??'Chưa có thông tin kinh nghiệm'} · {stats.find(s=>s.employee_id===a.employee_id)?.total_weekly_hours??'—'} giờ/tuần</p><p>{a.reason?.startsWith('LOCAL_SEARCH')?'Được chọn sau khi cân bằng giờ.':a.reason?.includes('MANAGER')?'Phân công do quản lý xác nhận.':a.reason?'Được chọn từ đăng ký hợp lệ.':'Lịch cũ chưa có lý do lựa chọn.'}</p>{a.selection_history&&<><p>Ban đầu: {employee(a.selection_history.initial.employee_id)} · {a.selection_history.replacements.length} lần điều chỉnh</p>{a.selection_history.replacements.map((v,j)=><p key={j}>{employee(v.from_employee_id)} → {employee(v.to_employee_id)} · Chỉ số cân bằng {v.objective_before.toFixed(2)} → {v.objective_after.toFixed(2)}</p>)}</>}</details></li>)}</ul></>}
 </aside>}</div>;
}

export function ScheduleTable({ context, saved, summary, preview }: { context: SchedulingContext; saved: SavedSchedule | null;summary?:RegistrationSummary|null;preview?:SchedulePreview|null }) {
  const display=preview?{assignments:preview.result.assignments,generation_snapshot:preview.result}:saved;
  const hasPlan=!!display;
  const rows = scheduleCalendarRows(context, display);
  const employeeName = (id: string) => context.employees.find(e => e.id === id)?.full_name || `Nhân viên ${id}`;
  const coverage=preview?.result.coverage??saved?.generation_snapshot?.coverage??[];
  const statistics=preview?.result.employee_statistics??saved?.generation_snapshot?.employee_statistics??[];
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
                  <td data-label="Nhân viên được phân công">{row.assignments.length ? <ul className="schedule-employee-chips">{row.assignments.map(a => <li key={a.id || a.employee_id}><details><summary>{employeeName(a.employee_id)}</summary>
                    <p>{context.employees.find(e=>e.id===a.employee_id)?.skill_level??'Chưa có cấp độ'} · Giờ tuần: {statistics.find(e=>e.employee_id===a.employee_id)?.total_weekly_hours??'Chưa có dữ liệu'}</p>
                    <p>{a.reason?.startsWith('LOCAL_SEARCH')?'Đã thay người để cải thiện cân bằng giờ, giữ coverage và cơ cấu kinh nghiệm.':a.reason?.includes('MANAGER_CONFIRMED')?'Quản lý lựa chọn, backend đã kiểm tra ràng buộc.':a.reason?'Engine chọn từ đăng ký hợp lệ, xét kinh nghiệm và tổng giờ.':'Lịch cũ chưa có dữ liệu lý do lựa chọn.'}</p>
                    {a.selection_history&&<p>Chọn ban đầu: {employeeName(a.selection_history.initial.employee_id)}. Số lần thay: {a.selection_history.replacements.length}.</p>}
                    {a.reason&&<details><summary>Dấu vết phân công</summary><p style={{overflowWrap:'anywhere'}}>{a.reason}</p>{a.selection_history?.replacements.map((event,i)=><p key={i}>{employeeName(event.from_employee_id)} → {employeeName(event.to_employee_id)}; chỉ số cân bằng {event.objective_before.toFixed(2)} → {event.objective_after.toFixed(2)}.</p>)}</details>}
                  </details></li>)}</ul> : <span className="schedule-muted">{coverage.some(c=>c.id===row.requirement_id&&!!c.existing_count)?'Phân công hiện hữu được giữ nguyên':'Chưa phân công'}</span>}</td>
                  <td data-label="Đã xếp / Cần"><span className="schedule-assignment-ratio" aria-label={`Đã xếp ${hasPlan ? row.assigned_count : 'chưa xác định'}, cần ${row.required_count ?? 'chưa xác định'}`}>{hasPlan ? row.assigned_count : '—'}<span> / </span>{row.required_count ?? '—'}</span>
                    {row.required_count === null && <small>{hasPlan && row.current_required_count !== null ? 'Chưa có nhu cầu trong phiên bản này' : 'Chưa nhập nhu cầu'}</small>}
                    {hasPlan && row.required_count === null && row.current_required_count !== null && <small>Nhu cầu hiện tại: {row.current_required_count}. Cần tạo phiên bản mới để sử dụng.</small>}
                  </td>
                  <td data-label="Trạng thái">{row.missing_count === null ? <span className="schedule-muted">Chưa thể đánh giá</span> : hasPlan ? <span className={`badge ${row.missing_count ? 'badge-yellow' : 'badge-green'}`}>{row.missing_count ? `Thiếu ${row.missing_count}` : 'Đủ người'}</span> : <span className="schedule-muted">Chưa có phân công</span>}
                    {coverage.filter(c=>c.id===row.requirement_id&&c.experienced_target!==undefined).map(c=><p key={c.id}>Kinh nghiệm: {c.experienced_count}/{c.experienced_target}{!!c.missing_experienced_count&&<strong className="schedule-day-missing"> · Thiếu {c.missing_experienced_count} người kinh nghiệm</strong>}{!!c.existing_count&&<small> · {c.existing_count} phân công hiện hữu hợp lệ</small>}</p>)}
                  </td>
                </tr>)}</tbody>
              </table>
            </section>;
          })}
        </div>
      </details>;
    })}
  </section>;
}

export function ScheduleStatistics({context,result}:{context:SchedulingContext;result:SavedSchedule['generation_snapshot']}) {
  if(!result)return null;
  return <details className="card schedule-additional"><summary>Tổng giờ làm và lịch sử tối ưu</summary>
    {result.optimization&&<p>Lần tối ưu đã ghi nhận: {result.optimization.iterations} lượt thay; chỉ số cân bằng {result.optimization.before.objective.toFixed(2)} → {result.optimization.after.objective.toFixed(2)}. {result.optimization.converged?'Đã hội tụ trong phạm vi thay một người.':'Đã dừng theo giới hạn tìm kiếm.'}</p>}
    <div className="schedule-table-scroll"><table className="schedule-table"><thead><tr><th>Nhân viên</th><th>Bộ phận</th><th>Số ca trong phương án</th><th>Tổng giờ tuần</th></tr></thead><tbody>{result.employee_statistics?.map(e=><tr key={e.employee_id}><td>{context.employees.find(p=>p.id===e.employee_id)?.full_name??e.employee_id}</td><td>{context.departments.find(d=>d.id===context.employees.find(p=>p.id===e.employee_id)?.department_id)?.name??'—'}</td><td>{e.shift_count}</td><td>{e.total_weekly_hours}</td></tr>)}</tbody></table></div>
    {!result.employee_statistics?.length&&<p>Phiên bản này chưa có thống kê giờ đã lưu.</p>}
    <p className="schedule-muted">Giờ tuần gồm phân công hiện hữu. Lịch sử tối ưu mô tả lần tạo phương án, không tự tối ưu lại khi mở lịch.</p>
  </details>;
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
  const [editor,setEditor]=useState<{preview:SchedulePreview|null;assignments:ScheduleAssignment[];dirty:boolean;unsaved:boolean}>({preview:null,assignments:[],dirty:false,unsaved:false});
  const {preview,assignments:edited,dirty:editDirty}=editor??{preview:null,assignments:[],dirty:false};
  const setPreview=(value:SchedulePreview|null)=>setEditor(old=>({...old,preview:value,unsaved:!!value}));
  const setEdited=(value:ScheduleAssignment[])=>setEditor(old=>({...old,assignments:value}));
  const setEditDirty=(value:boolean)=>setEditor(old=>({...old,dirty:value,unsaved:value||old.unsaved}));
  const [needId,setNeedId]=useState('');
  const [employeeId,setEmployeeId]=useState('');
  const [saving,setSaving]=useState(false);
  const [previewDay,setPreviewDay]=useState('');
  const [tab,setTab]=useState<'create'|'assignments'>('create');
  const [selectedCell,setSelectedCell]=useState('');
  const [prepareAfterSave,setPrepareAfterSave]=useState(false);
  const activeTab=tab??'create';
  const sequence = useRef(0);
  const submitting = useRef(false);
  const saveAttempt=useRef<{key:string;id:string}|null>(null);
  const selected = periods.find(p => p.id === periodId);
  const busy = loadingPeriods || loadingWeek || generating || saving;
  useUnsavedDemandGuard(!!editor?.unsaved||saving,'Lịch có thay đổi chưa lưu. Rời trang sẽ bỏ phương án đang chỉnh sửa. Tiếp tục?');
  const confirmDiscard=()=>!editor?.unsaved||typeof window==='undefined'||window.confirm('Lịch có thay đổi chưa lưu. Bỏ phương án hiện tại và tiếp tục?');
  const fail = (err: unknown) => err instanceof ApiError || err instanceof Error ? err.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';

  useEffect(() => {
    let active = true;
    setLoadingPeriods(true); setPeriods([]); setError(''); setNotice(''); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false);
    if (!user?.branch_id) { setLoadingPeriods(false); return; }
    schedulingService.periods().then(data => {
      if (!active) return;
      setPeriods(data);
      setPeriodId(current => {
        if(current&&!data.some(p=>p.id===current)){
          setError('Không tìm thấy tuần được yêu cầu trong chi nhánh của bạn. Hãy chọn tuần khác.');
          return current;
        }
        return current||(data.find(p=>p.status==='CLOSED')||data[0])?.id||'';
      });
    }).catch(err => { if (active) setError(fail(err)); })
      .finally(() => { if (active) setLoadingPeriods(false); });
    return () => { active = false; };
  }, [user?.id, user?.branch_id, reload]);

  useEffect(() => {
    const request = ++sequence.current;
    if (loadingPeriods || !selected) { setLoadingWeek(false); return; }
    setLoadingWeek(true); setError(''); setNotice(''); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false); setPreviewDay('');setSelectedCell('');
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
  }, [selected?.id, loadingPeriods]);

  const plain=(a:ScheduleAssignment)=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
  const generate = async (review=false,openSaved=false) => {
    if (!selected || !context || busy || submitting.current || (review&&!preview)) return;
    if(!review&&!openSaved&&!confirmDiscard())return;
    submitting.current=true;setGenerating(true);setError('');setNotice('');
    const request=++sequence.current;
    try {
      const target=preview?.edit_target??(saved&&['DRAFT','NEEDS_REVISION'].includes(saved.schedule.status)&&saved.source!=='mock'?{id:saved.schedule.id,version:saved.schedule.version}:null);
      const value=await schedulingService.preview(selected.id,target||review||openSaved?{...(target?{schedule_id:target.id,expected_version:target.version}:{}),...(review?{input_revision:preview!.input_revision,assignments:edited.map(plain)}:{}),...(openSaved?{use_saved_assignments:true as const}:{})}:undefined);
      if(sequence.current!==request)return;
      if(value.kind!=='preview'||value.persisted!==false||value.period.id!==selected.id||value.period.branch_id!==user?.branch_id)throw new Error('Invalid preview response');
      setEditor({preview:value,assignments:value.result.assignments.map(plain),dirty:false,unsaved:!openSaved});setContext(value.context);setNeedId(value.context.requirements[0]?.id||'');setEmployeeId('');
      if(!review)setPreviewDay('');
      setTab('assignments');setSelectedCell(value.context.requirements[0]?scheduleCellKey(value.context.requirements[0]):'');
      if(review)setNotice('Đã kiểm tra và xác nhận phương án điều chỉnh. Bảng lịch và chỉ số đã được cập nhật; lịch chưa được lưu.');
    }catch(err){if(sequence.current===request){setError(err instanceof ApiError&&err.code==='DEMAND_EXCEEDED'?'Phân công vượt nhu cầu. Vui lòng giảm số nhân viên ở ca được đánh dấu.':fail(err));if(err instanceof ApiError&&['PREVIEW_STALE','SCHEDULE_VERSION_CHANGED'].includes(err.code??'')){setEditDirty(true);}}}
    finally{submitting.current=false;if(sequence.current===request)setGenerating(false);}
  };
  const savePreview=async(prepareApproval=false)=>{
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
      setSaved(persisted);setPreview(null);setEdited([]);setEditDirty(false);setTab('create');setPrepareAfterSave(prepareApproval);saveAttempt.current=null;setNotice(`Đã lưu DRAFT phiên bản ${persisted.schedule.version}. Kiểm tra và chuẩn bị dữ liệu để gửi giám sát phê duyệt.`);
      setPeriods(old=>old.map(p=>p.id===selected.id?{...p,schedules:[...p.schedules.filter(s=>s.id!==persisted.schedule.id),persisted.schedule]}:p));
    }catch(err){if(sequence.current===request)setError(`${written?'Đã lưu DRAFT nhưng chưa đọc lại được. Hãy tải lại tuần hoặc thử lại cùng yêu cầu. ':''}${fail(err)}`);}
    finally{submitting.current=false;if(sequence.current===request)setSaving(false);}
  };
  const displayed=preview?{assignments:preview.result.assignments,generation_snapshot:preview.result}:saved;
  const rows = context ? scheduleRows(context, displayed) : [];
  const required = rows.reduce((sum, row) => sum + row.required_count, 0);
  const assigned = rows.reduce((sum, row) => sum + row.assigned_count, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing_count, 0);
  const existing = !!saved || !!selected?.schedules.length;
  const canGenerate = (!saved||['DRAFT','NEEDS_REVISION'].includes(saved.schedule.status)) && !!context && (selected?.status === 'CLOSED'||context.open_registration_preview_enabled===true) && !!context.requirements.length  && !busy;

  return <section className="manager-schedule manager-planner" aria-busy={busy}>
    <PlannerProgress periodStatus={selected?.status} scheduleStatus={saved?.schedule.status} hasPreview={!!preview}/>
    <nav className="planner-tabs" aria-label="Các bước lập lịch">{([['create','Tạo lịch'],['assignments','Phân công nhân viên']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={activeTab===value} onClick={()=>setTab(value)}>{label}</button>)}</nav>
    <div className="card schedule-controls">
      <div className="schedule-week-field"><label htmlFor="schedule-week"><CalendarDays size={17} aria-hidden="true" />Tuần cần lập lịch</label>
        <select id="schedule-week" value={periodId} disabled={busy || !periods.length} onChange={e => {
          if(!confirmDiscard())return;
          setPeriodId(e.target.value); setParams({ period_id: e.target.value }, { replace: true }); setContext(null); setSaved(null); setPreview(null); setEdited([]); setEditDirty(false); setError(''); setNotice('');
        }}><option value="" disabled>Chọn tuần làm việc</option>{periods.map(p => <option key={p.id} value={p.id}>{weekLabel(p)} · {statusLabel(p.status)}</option>)}</select>
      </div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => {if(confirmDiscard())setReload(n => n + 1);}}><RefreshCw size={16} aria-hidden="true" />Tải lại tuần</button>
      <Link className="btn btn-outline" to="/manager/publish">Phê duyệt & công bố</Link>
      {context&&!loadingWeek&&<span data-schedule-status={preview?'PREVIEW':saved?.schedule.status} className={`badge ${saved?.schedule.status==='DRAFT'?'badge-yellow':'badge-slate'}`}>{preview?'Lịch dự kiến — chưa lưu':statusLabel(saved?.schedule.status||context.period.status)}</span>}
      <button hidden={activeTab!=='create'} type="button" className="btn btn-primary" disabled={!canGenerate} onClick={() => void generate()}>{generating ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Wand2 size={17} aria-hidden="true" />}{generating ? 'Đang kiểm tra phương án…' : preview?'Tạo lại phương án':'Tạo lịch dự kiến'}</button>
    </div>
    {saved&&selected&&user?.branch_id&&!loadingPeriods&&!loadingWeek&&<ScheduleRevisionContext key={`${saved.schedule.id}/${saved.schedule.version}`} saved={saved} periodId={selected.id} branchId={user.branch_id} preview={preview}/>}
    <div hidden={activeTab!=='create'} className="planner-pane">
    {saved&&!preview&&!loadingPeriods&&!loadingWeek&&saved.schedule.status==='DRAFT'&&<ScheduleReviewPanel key={`${saved.schedule.id}/${saved.schedule.version}`} saved={saved} prepareOnMount={prepareAfterSave} onSubmitted={()=>{setPrepareAfterSave(false);setReload(n=>n+1);}}/>}
    {context?.source === 'mock' && <div className="schedule-info" role="status">Dữ liệu thử nghiệm — lịch chỉ lưu trong bộ nhớ backend, không gửi lên Supabase. {context.test_rules?.max_shifts_per_day?`Giới hạn ${context.test_rules.max_shifts_per_day} ca/ngày là cấu hình kiểm thử.`:'Không áp đặt giới hạn ca/ngày khi chưa cấu hình.'}</div>}
    {!loadingPeriods && <details className="workspace-disclosure"><summary>Đăng ký và khả năng đáp ứng nhân sự</summary><RegistrationSummaryPanel periodId={selected?.id || ''} refreshKey={reload} context={context} onSummary={setRegistrationSummary}/></details>}
    </div>
    {!user?.branch_id && <div className="schedule-alert" role="alert">Tài khoản quản lý chưa được phân công chi nhánh.</div>}
    {error && <div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>}
    {notice && <div className="schedule-alert schedule-alert-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span></div>}
    {(loadingPeriods || loadingWeek) && <div className="schedule-empty" role="status"><Loader2 className="spin" size={24} aria-hidden="true" />Đang đọc dữ liệu tuần và lịch đã lưu…</div>}
    {!loadingPeriods && !periods.length && !error && user?.branch_id && <div className="card schedule-empty"><CalendarDays size={30} aria-hidden="true" /><h3>Chưa có tuần đăng ký</h3><p>Nguồn dữ liệu đang chọn chưa có đợt cho chi nhánh. Có thể bật chế độ dữ liệu thử nghiệm trong development để thử TV3 mà không chờ TV2.</p></div>}
    {context && !loadingWeek && <>
      {saved&&!preview&&saved.schedule.status==='PENDING_APPROVAL'&&<div className="schedule-info" role="status">Lịch đã gửi và đang chờ Giám sát phê duyệt. Chưa công bố cho nhân viên.</div>}
      {preview&&<div className="planner-actions"><div className="preview-review-actions"><button type="button" className="btn btn-primary" disabled={busy||!editDirty} onClick={()=>void generate(true)}>{generating?<><Loader2 className="spin" size={16} aria-hidden="true"/>Đang kiểm tra…</>:'Kiểm tra lại phương án'}</button><button type="button" className="btn btn-outline" disabled={busy||editDirty||!preview.persistence.enabled} onClick={()=>void savePreview()}>{saving?'Đang lưu phương án…':'Lưu phương án'}</button></div><span className="schedule-muted">{editDirty?'Có thay đổi chưa kiểm tra':'Phương án đã kiểm tra · Chưa lưu'}</span></div>}
      {preview&&<>
        <ScheduleAIPanel preview={preview} previewDirty={editDirty||busy} employees={context.employees} autoEvaluate/>
        <div className="planner-actions" aria-label="Tiếp tục với phương án">
          <button type="button" className="btn btn-primary" disabled={busy||editDirty||!preview.persistence.enabled} onClick={()=>void savePreview(true)}>Gửi giám sát duyệt</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>setTab('assignments')}>Cân đối lịch</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void generate()}>Đề xuất lịch</button>
        </div>
        <p className="schedule-muted">Gửi giám sát duyệt sẽ lưu DRAFT và chuẩn bị kiểm tra; bạn cần xác nhận gửi ở bước tiếp theo. Cân đối thủ công cần Kiểm tra lại phương án; AI tự đánh giá phương án đã kiểm tra. Đề xuất lịch tạo lại bằng Rule Engine, có thể giữ nguyên nếu dữ liệu không đổi.</p>
      </>}
      <div hidden={activeTab!=='assignments'} className="planner-pane">
      {preview&&<div className="planner-inline-ai">
      <details className="card planner-ai-adjustment"><summary>Yêu cầu đề xuất điều chỉnh</summary>
      {preview&&<ScheduleAdjustmentIntent preview={preview} dirty={editDirty||busy} onApplied={value=>{
        if(value.kind!=='preview'||value.persisted!==false||value.input_revision!==preview.input_revision||JSON.stringify(value.edit_target??null)!==JSON.stringify(preview.edit_target??null)||value.period.id!==selected?.id||value.period.branch_id!==user?.branch_id||editDirty||busy)throw new Error('Lịch đang chỉnh sửa đã thay đổi. Hãy tạo lại đề xuất.');
        setPreview(value);setContext(value.context);setEdited(value.result.assignments.map(plain));setEditDirty(false);setNeedId(value.context.requirements[0]?.id||'');setEmployeeId('');saveAttempt.current=null;
      setNotice('Đã áp dụng phương án đã kiểm tra vào bảng đang chỉnh sửa. Lịch chưa được lưu hoặc công bố.');
      }}/>}
      </details></div>}
      {!preview&&<p className="schedule-muted">{saved?.schedule.status==='PUBLISHED'?'Lịch đã công bố chỉ để xem. AI tự đánh giá khi tạo phương án mới hợp lệ.':saved?'Mở bản nháp để điều chỉnh nếu muốn AI đánh giá phương án chưa lưu.':'Tạo phương án bằng Rule Engine để được kiểm tra và tự động đánh giá AI.'}</p>}
      <PlannerBoard context={context} saved={saved} preview={preview} summary={registrationSummary} edited={edited} dirty={editDirty} selectedCell={selectedCell??''} onSelect={key=>{setSelectedCell(key);const n=context.requirements.find(n=>scheduleCellKey(n)===key);setNeedId(n?.id??'');setEmployeeId('');}} day={previewDay??''} onDay={setPreviewDay}>
      {preview&&selectedCell ? <section className="preview-editor" aria-label="Điều chỉnh lịch dự kiến" aria-busy={generating}>
        <header className="preview-editor-heading">
          <div><h3>Điều chỉnh lịch dự kiến</h3><p className="schedule-muted">Lịch dự kiến — chưa lưu. Chọn nhân viên rồi kiểm tra lại trước khi tiếp tục.</p></div>
          <span className={`badge ${generating||editDirty?'badge-yellow':error?'badge-slate':'badge-green'}`} role="status">{generating?'Đang kiểm tra':error?'Kiểm tra thất bại':editDirty?'Có thay đổi chưa kiểm tra':notice?'Kiểm tra thành công':'Đã được hệ thống xác nhận'}</span>
        </header>
        <p className="schedule-muted">{editDirty?'Các lựa chọn chưa được kiểm tra; chỉ số tổng vẫn theo phương án đã xác nhận gần nhất.':'Phương án đã được kiểm tra; chưa lưu hoặc gửi phê duyệt.'}</p>
        <div className="preview-groups">
          {context.requirements.filter(n=>scheduleCellKey(n)===selectedCell).map(need=>{
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
        <details className="planner-selection-history"><summary>Lý do chọn và lịch sử điều chỉnh</summary>{editDirty&&<p>Của phương án đã kiểm tra gần nhất; các lựa chọn mới chưa được xác nhận.</p>}{preview.result.assignments.filter(a=>scheduleCellKey(a)===selectedCell).map((a,i)=><div key={i}><strong>{context.employees.find(e=>e.id===a.employee_id)?.full_name??'Nhân viên ngoài danh mục'}</strong><p>{a.reason?.startsWith('LOCAL_SEARCH')?'Được chọn sau khi cân bằng giờ.':a.reason?.includes('MANAGER')?'Do quản lý lựa chọn và đã kiểm tra.':a.reason?'Được chọn từ đăng ký hợp lệ, xét kinh nghiệm và tổng giờ.':'Chưa có lý do lựa chọn.'}</p>{a.selection_history?.replacements.map((v,j)=><p key={j}>{context.employees.find(e=>e.id===v.from_employee_id)?.full_name??'Người trước'} → {context.employees.find(e=>e.id===v.to_employee_id)?.full_name??'Người thay'} · {v.objective_before.toFixed(2)} → {v.objective_after.toFixed(2)}</p>)}</div>)}</details>
        <section className="preview-add" aria-label="Thêm nhân viên">
          <h4>Thêm nhân viên</h4>
          <div className="preview-add-grid">
            <label htmlFor="preview-need">Vị trí cần người<select id="preview-need" disabled={busy} value={needId} onChange={e=>{setNeedId(e.target.value);setEmployeeId('');const n=context.requirements.find(n=>n.id===e.target.value);if(n)setSelectedCell(scheduleCellKey(n));}}>{context.requirements.map(n=><option key={n.id} value={n.id}>{dateLabel(n.work_date)} · {context.shifts.find(s=>s.id===n.shift_id)?.name} · {context.departments.find(d=>d.id===n.department_id)?.name}</option>)}</select></label>
            <label htmlFor="preview-add-employee">Nhân viên<select id="preview-add-employee" disabled={busy} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Chọn nhân viên</option>{context.employees.filter(e=>e.department_id===context.requirements.find(n=>n.id===needId)?.department_id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
            <button type="button" className="btn btn-outline" disabled={busy||!employeeId||!needId} onClick={()=>{const n=context.requirements.find(n=>n.id===needId);if(n){setEdited([...edited,{employee_id:employeeId,work_date:n.work_date,shift_id:n.shift_id,department_id:n.department_id}]);setEditDirty(true);setError('');setNotice('');}}}>Thêm phân công</button>
          </div>
          <p className="schedule-muted">Cảnh báo chỉ hỗ trợ điều chỉnh. Hệ thống sẽ kiểm tra nguyện vọng và các ràng buộc khi xác nhận.</p>
        </section>

      </section>:undefined}
      </PlannerBoard>
      </div>
      <div hidden={activeTab!=='create'} className="planner-pane">
      {context?.open_registration_preview_enabled&&<div className="schedule-info" role="status">Development: cho phép tạo lại phương án khi đăng ký còn mở, chỉ trong kỳ kiểm thử này. Lưu/gửi duyệt vẫn chịu kiểm tra backend và RPC.</div>}
      {!existing && selected?.status !== 'CLOSED' && !context?.open_registration_preview_enabled && <div className="schedule-alert">Cần đóng đợt đăng ký trước khi tạo lịch dự kiến.</div>}
      {!context.requirements.length && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa khai báo nhu cầu nhân sự cho tuần này. Cần bổ sung nhu cầu trước khi tạo lịch.</span></div>}
      {context.valid_registration_count === 0 && !saved && <div className="schedule-alert"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa có đăng ký ca hợp lệ. Nếu tạo lịch, các vị trí cần người sẽ được ghi nhận còn thiếu.</span></div>}
      {editDirty&&<p className="schedule-muted">Các chỉ số dưới đây là phương án đã kiểm tra gần nhất.</p>}
      <div className="dashboard-metrics planner-metrics">
        {[['Nhân sự yêu cầu', required], ['Đã phân công', displayed ? assigned : '—'], ['Còn thiếu', displayed ? missing : '—'], ['Đăng ký ca hợp lệ', context.valid_registration_count]].map(([label, value]) => <div className="dashboard-metric" key={label}><div className="dashboard-metric-heading">{label}</div><div className="schedule-metric-value">{value}</div></div>)}
      </div>
      {saved&&!preview&&saved.source!=='mock'&&['DRAFT','NEEDS_REVISION'].includes(saved.schedule.status)&&<button className="btn btn-outline" type="button" disabled={busy} onClick={()=>void generate(false,true)}>{saved.schedule.status==='NEEDS_REVISION'?'Điều chỉnh lịch bị từ chối':'Chỉnh sửa DRAFT đã lưu'}</button>}
      {!preview&&saved?.demand_changed&&<div className="schedule-info schedule-demand-changed" role="status">Nhu cầu đã thay đổi so với lịch đang xem. Bấm Tạo lại lịch dự kiến để dùng nhu cầu mới.</div>}
      {saved && !preview && missing > 0 && <div className="schedule-info" role="status"><AlertTriangle size={18} aria-hidden="true" /><span>Chưa đủ nhân viên phù hợp: thiếu {missing} lượt phân công ở {rows.filter(r => r.missing_count > 0).length} ca/bộ phận. Quản lý cần xem xét và bổ sung nhân sự trước khi trình duyệt.</span></div>}
      <details className="workspace-disclosure"><summary>Thống kê giờ làm và cơ cấu nhân viên</summary><ScheduleStatistics context={context} result={preview?.result??saved?.generation_snapshot??null}/></details>
      {saved && !preview && saved.generation_snapshot?.rule_version!=='tv3.rules.v2' && (saved.generation_snapshot?.new_employee_count_threshold == null || saved.generation_snapshot?.coverage?.some(r => r.warning)) && <details className="schedule-additional"><summary>Thông tin bổ sung · Cơ cấu nhân viên mới</summary>
        {saved.generation_snapshot?.new_employee_count_threshold == null && <p>Chưa đủ dữ liệu đánh giá: chưa có ngưỡng cảnh báo NEW trong kết quả lịch.</p>}
        {saved.generation_snapshot?.coverage?.some(r => r.warning) && <p>Có ca nhiều nhân viên mới và không có Crew Training theo ngưỡng đã cấu hình. Vui lòng kiểm tra cơ cấu nhân sự.</p>}
      </details>}
      {saved && !preview && !rows.length && <div className="schedule-alert">Lịch này chưa có dữ liệu nhu cầu để đối chiếu; các ca vẫn được hiển thị và không được coi là nhu cầu 0.</div>}
      {!preview&&saved?.source==='mock'&&context.source==='mock'&&<MockDraftEditor key={saved.schedule.id} context={context} saved={saved} onSaved={value=>{if(value.schedule.period_id===selected?.id){setSaved(value);setNotice('Đã kiểm tra và lưu phiên bản DRAFT thử nghiệm mới trong bộ nhớ.');}}}/>}
      </div>
    </>}
    {error && <Link className="schedule-help-link" to="/manager">Về tổng quan quản lý</Link>}
  </section>;
}
