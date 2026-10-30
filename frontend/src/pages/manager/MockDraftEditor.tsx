import { useEffect, useRef, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel } from '../../services/scheduling.view';
import type { SavedSchedule, ScheduleAssignment, SchedulingContext } from '../../types/scheduling';
const plain=(a:ScheduleAssignment)=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
export function MockDraftEditor({context,saved,onSaved}:{context:SchedulingContext;saved:SavedSchedule;onSaved:(saved:SavedSchedule)=>void}) {
  const [assignments,setAssignments]=useState(saved.assignments.map(plain));
  const [needId,setNeedId]=useState(context.requirements[0]?.id??'');
  const [employeeId,setEmployeeId]=useState('');const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const need=context.requirements.find(r=>r.id===needId);
  const save=async()=>{
    if(busy)return;setBusy(true);setError('');let written=false;
    try{
      const result=await schedulingService.editDraft(saved.schedule.id,{expected_version:saved.schedule.version,assignments,note});written=true;
      const persisted=await schedulingService.read(result.schedule.id);
      if(active.current)onSaved(persisted);
    }catch(err){if(active.current)setError(`${written?'Đã lưu phiên bản thử nghiệm nhưng chưa đọc lại được. Hãy tải lại tuần. ':''}${err instanceof Error?err.message:'Không thể lưu chỉnh sửa.'}`);}
    finally{if(active.current)setBusy(false);}
  };
  return <section className="card summary-panel" aria-label="Chỉnh sửa lịch thử nghiệm">
    <h3>Chỉnh sửa lịch dự kiến thử nghiệm</h3><p className="schedule-muted">Thay người, bỏ hoặc thêm phân công. Khi lưu, Backend kiểm tra lại đăng ký, bộ phận/kỹ năng, trùng ca và các giới hạn đã cấu hình. {context.test_rules?.max_shifts_per_day?`Giới hạn thử nghiệm: ${context.test_rules.max_shifts_per_day} ca/ngày.`:''} Mỗi lần lưu hợp lệ tạo phiên bản DRAFT mới trong bộ nhớ.</p>
    {saved.demand_changed&&<div className="schedule-alert">Nhu cầu đã đổi; hãy tạo lại lịch trước khi chỉnh sửa.</div>}
    <fieldset className="mock-edit-fields" disabled={busy||saved.demand_changed}>
      {assignments.map((assignment,index)=><div className="mock-assignment-row" key={index}>
        <span>{dateLabel(assignment.work_date)} · {context.shifts.find(s=>s.id===assignment.shift_id)?.name} · {context.departments.find(d=>d.id===assignment.department_id)?.name}</span>
        <select aria-label={`Nhân viên phân công ${index+1}`} value={assignment.employee_id} onChange={e=>setAssignments(rows=>rows.map((row,i)=>i===index?{...row,employee_id:e.target.value}:row))}>
          {context.employees.filter(e=>e.department_id===assignment.department_id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" type="button" onClick={()=>setAssignments(rows=>rows.filter((_,i)=>i!==index))}>Bỏ phân công</button>
      </div>)}
      <div className="summary-filters">
        <label>Vị trí cần thêm<select value={needId} onChange={e=>{setNeedId(e.target.value);setEmployeeId('');}}>{context.requirements.map(r=><option key={r.id} value={r.id}>{dateLabel(r.work_date)} · {context.shifts.find(s=>s.id===r.shift_id)?.name} · {context.departments.find(d=>d.id===r.department_id)?.name}</option>)}</select></label>
        <label>Nhân viên<select value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Chọn nhân viên</option>{context.employees.filter(e=>e.department_id===need?.department_id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
        <button className="btn btn-outline" type="button" disabled={!need||!employeeId} onClick={()=>{if(need&&employeeId)setAssignments(rows=>[...rows,{employee_id:employeeId,work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id}]);}}>Thêm phân công</button>
      </div>
      <label className="mock-edit-note">Ghi chú điều chỉnh<textarea value={note} rows={2} onChange={e=>setNote(e.target.value)}/></label>
      <button className="btn btn-primary" type="button" onClick={()=>void save()}>Kiểm tra và lưu dự kiến thử nghiệm</button>
    </fieldset>
    {error&&<div className="schedule-alert schedule-alert-error" role="alert">{error}</div>}
  </section>;
}
