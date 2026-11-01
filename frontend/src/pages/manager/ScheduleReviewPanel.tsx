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
export function ScheduleReviewPanel({saved,onSubmitted}:{saved:SavedSchedule;onSubmitted?:()=>void}){
  const [validation,setValidation]=useState<ScheduleValidation|null>(null);
  const [handoff,setHandoff]=useState<ApprovalHandoff|null>(null);
  const [note,setNote]=useState(saved.note??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const active=useRef(true);const working=useRef(false);
  const attempt=useRef<{key:string;id:string}|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const check=async(prepare:boolean)=>{
    if(working.current)return;working.current=true;setBusy(true);setError('');setHandoff(null);setValidation(null);
    try{
      if(prepare){const result=await schedulingService.prepareHandoff(saved.schedule.id,saved.schedule.version,note);if(active.current){setHandoff(result);setValidation(result.validation);}}
      else{const result=await schedulingService.validate(saved.schedule.id,saved.schedule.version);if(active.current)setValidation(result);}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Không thể kiểm tra hoặc chuẩn bị bàn giao.');}
    finally{working.current=false;if(active.current)setBusy(false);}
  };
  const submit=async()=>{
    if(working.current||!handoff?.delivery.configured||!handoff.validation.can_submit||saved.schedule.status!=='DRAFT')return;
    if(!window.confirm(`Gửi phiên bản ${saved.schedule.version} cho giám sát phê duyệt?`))return;
    working.current=true;setBusy(true);setError('');
    try{
      const key=JSON.stringify([saved.schedule.id,saved.schedule.version,note]);
      if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
      await schedulingService.submitApproval(saved.schedule.id,saved.schedule.version,note,attempt.current!.id);
      if(active.current){setHandoff({...handoff,delivery:{configured:true,sent:true,message:'Đã gửi và lưu trạng thái chờ phê duyệt.'}});onSubmitted?.();}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Không thể gửi lịch.');}
    finally{working.current=false;if(active.current)setBusy(false);}
  };
  return <section className="card summary-panel" aria-label="Kiểm tra lịch và chuẩn bị bàn giao TV4" aria-busy={busy}>
    <h3>Kiểm tra lịch &amp; chuẩn bị gửi Giám sát khu vực phê duyệt</h3>
    <p className="schedule-muted">Trạng thái lịch hiện tại: {handoff?.delivery.sent?'PENDING_APPROVAL':saved.schedule.status}. Backend kiểm tra lại phiên bản và ràng buộc trước khi ghi trạng thái và audit.</p>
    <label className="mock-edit-note">Ghi chú bàn giao<textarea rows={2} value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setHandoff(null);}}/></label>
    <div className="schedule-review-actions">
      <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void check(false)}>Kiểm tra lịch</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void check(true)}>Chuẩn bị dữ liệu gửi phê duyệt</button>
      <button type="button" className="btn btn-outline" disabled={busy||saved.schedule.status!=='DRAFT'||!handoff?.delivery.configured||!handoff.validation.can_submit||handoff.delivery.sent} onClick={()=>void submit()}>Gửi Giám sát khu vực phê duyệt</button>
    </div>
    <p className="schedule-muted">{handoff?.delivery.configured?'Gửi duyệt sẽ khóa chỉnh sửa phiên bản này. Lịch bị từ chối phải được lưu thành DRAFT phiên bản mới trước khi gửi lại.':'Chưa kết nối API tiếp nhận TV4 hoặc chưa bật persistence. Chưa gửi lịch.'}</p>
    {error&&<div className="schedule-alert schedule-alert-error" role="alert">{error}</div>}
    {validation&&<ScheduleValidationView validation={validation}/>}
    {handoff&&<div className="schedule-alert" role="status">{handoff.validation.can_submit?'Dữ liệu đáp ứng kiểm tra để chuẩn bị bàn giao.':'Chưa thể bàn giao: cần xử lý các vấn đề được liệt kê.'} {handoff.delivery.message}</div>}
    {handoff?.payload&&<details><summary>Xem dữ liệu bàn giao TV4 (chưa gửi)</summary><pre className="handoff-preview">{JSON.stringify(handoff.payload,null,2)}</pre></details>}
  </section>;
}
