import { useEffect, useRef, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import type { ApprovalHandoff, SavedSchedule, ScheduleValidation } from '../../types/scheduling';
export function ScheduleValidationView({validation}:{validation:ScheduleValidation}){
  return <div className="summary-panel">
    <p>Ràng buộc phân công: <strong>{{PASS:'Đạt kiểm tra',FAIL:'Có vi phạm',UNKNOWN:'Chưa đủ dữ liệu'}[validation.hard_constraints]}</strong> · Định biên: <strong>{validation.coverage_complete?'Đủ người':'Chưa đủ người hoặc chưa thể đánh giá'}</strong></p>
    <p className="schedule-muted">Kiểm tra phiên bản {validation.version}, trên nhu cầu đã khai báo và đăng ký VALID. Đây không phải kết quả phê duyệt.</p>
    {validation.issues.map((issue,index)=><div className="schedule-alert" key={`${issue.code}/${index}`}>{issue.message}</div>)}
    {validation.warnings.map((warning,index)=><p className="schedule-muted" key={`${warning.code}/${index}`}>{warning.message}</p>)}
  </div>;
}
export function ScheduleReviewPanel({saved}:{saved:SavedSchedule}){
  const [validation,setValidation]=useState<ScheduleValidation|null>(null);
  const [handoff,setHandoff]=useState<ApprovalHandoff|null>(null);
  const [note,setNote]=useState(saved.note??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const active=useRef(true);const working=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const check=async(prepare:boolean)=>{
    if(working.current)return;working.current=true;setBusy(true);setError('');setHandoff(null);setValidation(null);
    try{
      if(prepare){const result=await schedulingService.prepareHandoff(saved.schedule.id,saved.schedule.version,note);if(active.current){setHandoff(result);setValidation(result.validation);}}
      else{const result=await schedulingService.validate(saved.schedule.id,saved.schedule.version);if(active.current)setValidation(result);}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Không thể kiểm tra hoặc chuẩn bị bàn giao.');}
    finally{working.current=false;if(active.current)setBusy(false);}
  };
  return <section className="card summary-panel" aria-label="Kiểm tra lịch và chuẩn bị bàn giao TV4" aria-busy={busy}>
    <h3>Kiểm tra lịch &amp; chuẩn bị gửi Giám sát khu vực phê duyệt</h3>
    <p className="schedule-muted">TV3 kiểm tra dữ liệu và chuẩn bị hợp đồng bàn giao. Trạng thái lịch hiện vẫn là {saved.schedule.status}; chỉ yêu cầu chuyển sang PENDING_APPROVAL khi TV4 tiếp nhận đúng phiên bản.</p>
    <label className="mock-edit-note">Ghi chú bàn giao<textarea rows={2} value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setHandoff(null);}}/></label>
    <div className="schedule-review-actions">
      <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void check(false)}>Kiểm tra lịch</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void check(true)}>Chuẩn bị dữ liệu gửi phê duyệt</button>
      <button type="button" className="btn btn-outline" disabled title="Chưa kết nối API tiếp nhận TV4">Gửi Giám sát khu vực phê duyệt</button>
    </div>
    <p className="schedule-muted">Chưa kết nối API tiếp nhận TV4. Chưa gửi lịch; không tự phê duyệt hoặc công bố.</p>
    {error&&<div className="schedule-alert schedule-alert-error" role="alert">{error}</div>}
    {validation&&<ScheduleValidationView validation={validation}/>}
    {handoff&&<div className="schedule-alert" role="status">{handoff.validation.can_submit?'Dữ liệu đáp ứng kiểm tra để chuẩn bị bàn giao.':'Chưa thể bàn giao: cần xử lý các vấn đề được liệt kê.'} {handoff.delivery.message}</div>}
    {handoff?.payload&&<details><summary>Xem dữ liệu bàn giao TV4 (chưa gửi)</summary><pre className="handoff-preview">{JSON.stringify(handoff.payload,null,2)}</pre></details>}
  </section>;
}
