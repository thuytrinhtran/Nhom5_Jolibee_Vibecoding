import { useEffect, useRef, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import type { ApprovalHandoff, SavedSchedule, ScheduleValidation } from '../../types/scheduling';
export function ScheduleValidationView({validation}:{validation:ScheduleValidation}){
  const totals=coverageTotals(validation.coverage);
  return <div className="summary-panel">
    <p>Tổng nhu cầu: <strong>{totals.required}</strong> lượt · Đã phân công: <strong>{totals.assigned}</strong> lượt · Còn thiếu: <strong>{totals.missing}</strong> lượt.</p>
    <p>Dữ liệu nguồn: {validation.source_state==='CURRENT'?'Khớp thời điểm lưu DRAFT':validation.source_state==='CHANGED'?'Đã thay đổi — cần kiểm tra và lưu DRAFT mới':'Chưa xác minh được — chưa thể gửi duyệt'}.</p>
    <p>Ràng buộc phân công: <strong>{{PASS:'Đạt kiểm tra',FAIL:'Có vi phạm',UNKNOWN:'Chưa đủ dữ liệu'}[validation.hard_constraints]}</strong> · Định biên: <strong>{validation.coverage_complete?'Đủ người':'Chưa đủ người hoặc chưa thể đánh giá'}</strong></p>
    <p className="schedule-muted">Đối chiếu với nhu cầu và đăng ký hợp lệ. Đây chưa phải kết quả phê duyệt.</p>
    {validation.issues.map((issue,index)=><div className="schedule-alert" key={`${issue.code}/${index}`}>{issue.message}</div>)}
    {validation.warnings.map((warning,index)=><p className="schedule-muted" key={`${warning.code}/${index}`}>{warning.message}</p>)}
  </div>;
}
export function coverageTotals(rows:ScheduleValidation['coverage']){
  return rows.reduce((sum,c)=>({required:sum.required+c.required_count,assigned:sum.assigned+c.assigned_count,missing:sum.missing+c.missing_count}),{required:0,assigned:0,missing:0});
}
export function submitConfirmation(validation:ScheduleValidation){
  const totals=coverageTotals(validation.coverage);
  return totals.missing>0?`Lịch đã xếp ${totals.assigned}/${totals.required} lượt, còn thiếu ${totals.missing} lượt phân công. Vẫn gửi cho giám sát xem xét và xác nhận tình trạng thiếu nhân sự?`:'Gửi lịch đã lưu cho giám sát phê duyệt?';
}
export function ScheduleReviewPanel({saved,onSubmitted}:{saved:SavedSchedule;onSubmitted?:()=>void}){
  const [validation,setValidation]=useState<ScheduleValidation|null>(null);
  const [handoff,setHandoff]=useState<ApprovalHandoff|null>(null);
  const [note,setNote]=useState(saved.note??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const active=useRef(true);const working=useRef(false);
  const attempt=useRef<{key:string;id:string;prepared:ApprovalHandoff}|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const submit=async()=>{
    if(working.current||handoff?.delivery.sent||saved.schedule.status!=='DRAFT')return;
    working.current=true;setBusy(true);setError('');
    try{
      const key=JSON.stringify([saved.schedule.id,saved.schedule.version,note]);
      const retry=attempt.current?.key===key;
      const prepared=retry?attempt.current!.prepared:await schedulingService.prepareHandoff(saved.schedule.id,saved.schedule.version,note);
      if(!active.current)return;
      setHandoff(prepared);setValidation(prepared.validation);
      if(prepared.validation.schedule_id!==saved.schedule.id||prepared.validation.version!==saved.schedule.version)throw new Error('Kết quả kiểm tra không khớp phiên bản đang mở. Hãy tải lại tuần.');
      if(!prepared.delivery.configured)throw new Error('Chưa bật gửi duyệt cho tuần hoặc chi nhánh này. Liên hệ quản trị viên.');
      if(!prepared.validation.can_submit||prepared.validation.source_state!=='CURRENT'||prepared.validation.hard_constraints!=='PASS'||!prepared.validation.data_complete||!prepared.validation.input_current)throw new Error('Chưa thể gửi: cần dữ liệu nguồn CURRENT và các kiểm tra bắt buộc đạt. Xem chi tiết bên dưới.');
      if(!retry&&!window.confirm(submitConfirmation(prepared.validation)))return;
      if(!retry)attempt.current={key,id:crypto.randomUUID(),prepared};
      await schedulingService.submitApproval(saved.schedule.id,saved.schedule.version,note,attempt.current!.id);
      if(active.current){setHandoff({...prepared,delivery:{configured:true,sent:true,message:'Đã gửi và lưu trạng thái chờ phê duyệt.'}});onSubmitted?.();}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Không thể gửi lịch.');}
    finally{working.current=false;if(active.current)setBusy(false);}
  };
  return <section className="card summary-panel" aria-label="Gửi lịch phê duyệt" aria-busy={busy}>
    <h3>Gửi giám sát phê duyệt</h3>
    <p>Bản nháp đã lưu · Phiên bản {saved.schedule.version}</p>
    <p className="schedule-muted">Trạng thái: {handoff?.delivery.sent?'Chờ phê duyệt':({DRAFT:'Bản nháp',NEEDS_REVISION:'Cần điều chỉnh',PENDING_APPROVAL:'Chờ phê duyệt',APPROVED:'Đã phê duyệt',PUBLISHED:'Đã công bố'}[saved.schedule.status]??saved.schedule.status)}. Gửi duyệt sẽ khóa chỉnh sửa lịch này.</p>
    <label className="mock-edit-note">Ghi chú bàn giao<textarea rows={2} value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setHandoff(null);}}/></label>
    <div className="schedule-review-actions">
      <button type="button" className="btn btn-primary" disabled={busy||saved.schedule.status!=='DRAFT'||handoff?.delivery.sent} onClick={()=>void submit()}>{busy?'Đang kiểm tra và gửi…':handoff?.delivery.sent?'Đã gửi giám sát':'Gửi giám sát phê duyệt'}</button>
    </div>
    <p className="schedule-muted">Hệ thống tự kiểm tra dữ liệu nguồn và phân công trước khi yêu cầu xác nhận. Gửi duyệt dùng đúng bản đã lưu, không tạo phiên bản mới.</p>
    {error&&<div className="schedule-alert schedule-alert-error" role="alert">{error}</div>}
    {validation&&<ScheduleValidationView validation={validation}/>}
    {handoff?.delivery.sent&&<div className="schedule-alert" role="status">{handoff.delivery.message}</div>}
  </section>;
}
