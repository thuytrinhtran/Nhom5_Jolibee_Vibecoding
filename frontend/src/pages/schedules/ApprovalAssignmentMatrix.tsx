import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleAssignment, ScheduleWorkflowRecord, ScheduleWorkflowService } from './scheduleWorkflow.types';
import { approvalMatrixView, cellKey, type ApprovalReview } from './approvalMatrix.view';
import './ApprovalAssignmentMatrix.css';

const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
const weekday=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('vi-VN',{weekday:'short',timeZone:'UTC'});
const value=(n:number|undefined)=>typeof n==='number'?n:'Chưa có dữ liệu';

function EmployeeList({entries}:{entries:ScheduleAssignment[]}){
  return <div className="approval-matrix-people">{entries.map((a,index)=><details className="approval-matrix-person" key={a.id||index}>
    <summary>{a.employees.full_name||'Chưa có tên nhân viên'}</summary>
    <p>{a.work_date} · {a.shifts.name||'Chưa có tên ca'}<br/>{a.shifts.start_time&&a.shifts.end_time?`${a.shifts.start_time.slice(0,5)}–${a.shifts.end_time.slice(0,5)}`:'Chưa có giờ ca'}<br/>{a.departments.name||'Chưa có tên bộ phận'}</p>
    <p className="approval-matrix-muted">Trạng thái phân công: {a.status==='DRAFT'?'Bản nháp':a.status==='ACTIVE'?'Hiện hành':a.status}</p>
  </details>)}</div>;
}

/** Only reads assignments. No decision, edit, or mutation callback is accepted. */
export function ApprovalAssignmentMatrixContent({schedule,review,loading=false,error=''}:{schedule:ScheduleWorkflowRecord;review:ApprovalReview|null;loading?:boolean;error?:string}){
  const model=useMemo(()=>approvalMatrixView(schedule,review),[schedule,review]);
  const [day,setDay]=useState(''),[department,setDepartment]=useState(''),[filter,setFilter]=useState('all'),[selected,setSelected]=useState('');
  const detailRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(selected)detailRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[selected]);
  const matches=(c:typeof model.cells[number])=>(!day||c.date===day)&&(!department||c.departmentId===department)&&(filter==='all'||filter==='attention'&&(c.staffingShortage||c.experienceShortage)||filter==='staffing'&&c.staffingShortage||filter==='experience'&&c.experienceShortage);
  const visible=model.cells.filter(matches),dates=day?[day]:model.days;
  const rows=model.rows.filter(row=>(!department||row.departmentId===department)&&(filter==='all'||visible.some(c=>c.shift.id===row.shift.id&&c.departmentId===row.departmentId)));
  const chosen=visible.find(c=>c.key===selected);
  function resetSelection(){setSelected('');}
  return <section className="approval-assignment-matrix" aria-label="Chi tiết phân công dạng ma trận tuần">
    <div className="approval-matrix-heading"><h3>Chi tiết phân công</h3><span>Ma trận tuần · Chỉ xem</span></div>
    <p className="approval-matrix-muted">{model.active.length} lượt phân công hiện hành thuộc lịch này{model.replacedCount>0?` · ${model.replacedCount} phân công đã thay thế không tính vào ma trận`:''}.</p>
    <p className="approval-matrix-muted">Số đã xếp / nhu cầu theo kết quả kiểm tra, có thể bao gồm phân công hợp lệ ngoài lịch này.</p>
    {loading&&<p role="status">Đang tải dữ liệu định biên…</p>}
    {error&&<p role="alert" className="approval-matrix-notice">Không thể tải định biên: {error}. Không thể xác định tình trạng đủ/thiếu từ số tên.</p>}
    <div className="approval-matrix-filters">
      <label>Ngày<select aria-label="Ngày" value={day} onChange={e=>{setDay(e.target.value);resetSelection();}}><option value="">Cả tuần</option>{model.days.map(d=><option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
      <label>Bộ phận<select aria-label="Bộ phận" value={department} onChange={e=>{setDepartment(e.target.value);resetSelection();}}><option value="">Tất cả bộ phận</option>{[...new Map(model.rows.map(r=>[r.departmentId,r.departmentName]))].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Hiển thị<select aria-label="Hiển thị" value={filter} onChange={e=>{setFilter(e.target.value);resetSelection();}}><option value="all">Tất cả ca</option><option value="attention">Cần chú ý</option><option value="staffing">Thiếu nhân sự</option><option value="experience">Thiếu kinh nghiệm</option></select></label>
    </div>
    <div className="approval-matrix-legend"><span>Đủ theo định biên</span><span>Thiếu người</span><span>Thiếu kinh nghiệm</span><span>{visible.length} ô phù hợp</span></div>
    {rows.length&&dates.length?<div className="approval-matrix-scroll" tabIndex={0} role="region" aria-label="Ma trận phân công, có thể cuộn ngang trên màn hình nhỏ"><table className="approval-matrix-table">
      <thead><tr><th scope="col">Ca / Bộ phận</th>{dates.map(d=><th scope="col" key={d}>{weekday(d)}<br/>{dateLabel(d)}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={cellKey('',row.shift.id,row.departmentId)}><th scope="row"><strong>{row.shift.name}</strong><span>{row.departmentName}</span>{row.shift.time&&<small>{row.shift.time}</small>}</th>{dates.map(d=>{
        const c=model.cells.find(c=>c.key===cellKey(d,row.shift.id,row.departmentId))!;
        if(!matches(c))return <td key={d} className="approval-matrix-filtered"><span aria-label="Không phù hợp bộ lọc">—</span></td>;
        const unknown=!c.coverage;
        const cClass=unknown?'unknown':c.staffingShortage?'shortage':c.experienceShortage?'experience':'covered';
        const experienceKnown=typeof c.coverage?.missing_experienced_count==='number';
        return <td key={d}><button type="button" className={`approval-matrix-cell ${cClass}`} aria-pressed={selected===c.key} aria-label={`${d}, ${row.shift.name}, ${row.departmentName}`} onClick={()=>setSelected(c.key)}>
          {c.coverage?<><strong>{c.coverage.assigned_count}/{c.coverage.required_count}</strong><span>{c.staffingShortage?`Thiếu ${c.coverage.missing_count} người`:'Đủ theo định biên'}</span>{c.experienceShortage&&<span className="approval-matrix-experience">{experienceKnown?`Thiếu ${c.coverage.missing_experienced_count} kinh nghiệm`:'Cảnh báo thiếu kinh nghiệm'}</span>}{!experienceKnown&&<small>Chưa có dữ liệu kinh nghiệm</small>}</>:<span>{c.sources.length>1?'Nhiều bản ghi định biên, cần kiểm tra':'Chưa có dữ liệu định biên'}</span>}
          <small>{c.assignments.length} lượt trong lịch · Xem</small>
        </button></td>;
      })}</tr>)}</tbody>
    </table></div>:<p className="approval-matrix-empty">Không có ô phù hợp. Chọn “Tất cả ca” để xem đầy đủ dữ liệu hiện có.</p>}
    {chosen&&<section className="approval-matrix-detail" ref={detailRef} aria-label="Chi tiết ô phân công">
      <div className="approval-matrix-heading"><h4>{dateLabel(chosen.date)} · {chosen.shift.name} · {chosen.departmentName}</h4><button type="button" onClick={()=>setSelected('')}>Đóng chi tiết</button></div>
      {chosen.coverage?<><p>Đã xếp / nhu cầu: <strong>{chosen.coverage.assigned_count}/{chosen.coverage.required_count}</strong>{chosen.shift.time?` · ${chosen.shift.time}`:''}</p><p>Kinh nghiệm / mục tiêu: {value(chosen.coverage.experienced_count)} / {value(chosen.coverage.experienced_target)}</p>
        {typeof chosen.coverage.existing_count==='number'&&<p>Phân công có sẵn hợp lệ trong tổng đã xếp: {chosen.coverage.existing_count}.</p>}
        {chosen.staffingShortage&&<p className="approval-matrix-notice">Thiếu {chosen.coverage.missing_count} người theo kết quả kiểm tra.</p>}
        {chosen.experienceShortage&&<p className="approval-matrix-notice">{typeof chosen.coverage.missing_experienced_count==='number'?`Thiếu ${chosen.coverage.missing_experienced_count} nhân viên kinh nghiệm so với mục tiêu.`:'Có cảnh báo thiếu kinh nghiệm; chưa có số lượng cụ thể.'}</p>}
        {[...new Set([...(chosen.coverage.warnings??[]),chosen.coverage.warning].filter((w):w is string=>!!w&&!['STAFFING_SHORTAGE','EXPERIENCE_SHORTAGE'].includes(w)))].map(w=><p className="approval-matrix-notice" key={w}>Cảnh báo: {w}</p>)}
      </>:<p className="approval-matrix-notice">{chosen.sources.length>1?'Có nhiều bản ghi cho ô này; không tự gộp số liệu.':'Chưa có dữ liệu định biên. Không thể kết luận đủ hoặc thiếu nhân sự.'}</p>}
      <h4>Nhân viên thuộc lịch đang duyệt ({chosen.assignments.length} lượt)</h4>
      <p className="approval-matrix-muted">Danh sách này không đại diện đầy đủ cho phân công ngoài lịch. Chọn tên để xem thông tin; không có dữ liệu cấp độ kinh nghiệm từng người.</p>
      {chosen.assignments.length?<EmployeeList entries={chosen.assignments}/>:<p>Không có phân công hiện hành thuộc lịch này trong ô đã chọn.</p>}
    </section>}
    {model.ungrouped.length>0&&<details className="approval-matrix-ungrouped"><summary>{model.ungrouped.length} phân công chưa thể đặt vào ô do thiếu thông tin ngày, ca hoặc bộ phận</summary><p>Các phân công này vẫn được giữ lại để kiểm tra. Chưa đủ dữ liệu để đặt vào ô lịch.</p><EmployeeList entries={model.ungrouped}/></details>}
  </section>;
}

export function ApprovalAssignmentMatrix({schedule,service}:{schedule:ScheduleWorkflowRecord;service:ScheduleWorkflowService}){
  const [state,setState]=useState<{scope:string;review:ApprovalReview|null;error:string;loading:boolean}>({scope:'',review:null,error:'',loading:true});
  const scope=JSON.stringify([schedule.id,schedule.version]);
  useEffect(()=>{
    let active=true;setState({scope,review:null,error:'',loading:true});
    if(!service.reviewSchedule){setState({scope,review:null,error:'Dịch vụ chưa cung cấp kiểm tra lịch',loading:false});return;}
    void service.reviewSchedule(schedule.id).then(review=>{
      if(review.validation.schedule_id!==schedule.id||review.validation.version!==schedule.version)throw Error('Kết quả kiểm tra không khớp phiên bản lịch. Hãy tải lại danh sách');
      if(active)setState({scope,review,error:'',loading:false});
    }).catch(e=>{if(active)setState({scope,review:null,error:e instanceof Error?e.message:'Không tải được dữ liệu',loading:false});});
    return()=>{active=false;};
  },[scope,service,schedule.id,schedule.version]);
  const current=state.scope===scope?state:{review:null,error:'',loading:true};
  return <ApprovalAssignmentMatrixContent key={scope} schedule={schedule} review={current.review} loading={current.loading} error={current.error}/>;
}
