import { useEffect, useRef, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import type { ApprovalHandoff, SavedSchedule, ScheduleValidation } from '../../types/scheduling';
export function ScheduleValidationView({validation}:{validation:ScheduleValidation}){
  return <div className="summary-panel">
    <p>Ràng buộc phân công: <strong>{{PASS:'Đạt kiểm tra',FAIL:'Có vi phạm',UNKNOWN:'Chưa đủ dữ liệu'}[validation.hard_constraints]}</strong> · Định biên: <strong>{validation.coverage_complete?'Đủ người':'Chưa đủ người hoặc chưa thể đánh giá'}</strong></p>
    <p className="schedule-muted">Đối chiếu với nhu cầu và đăng ký hợp lệ. Đây chưa phải kết quả phê duyệt.</p>
    <p className="schedule-muted">Thiếu nhân lực hoặc dư ứng viên là cảnh báo để giám sát xem xét, không chặn gửi duyệt khi các kiểm tra bắt buộc đạt.</p>
    {validation.issues.map((issue,index)=><div className="schedule-alert" key={`${issue.code}/${index}`}>{issue.message}</div>)}
    {validation.warnings.map((warning,index)=><p className="schedule-muted" key={`${warning.code}/${index}`}>{warning.message}</p>)}
  </div>;
}
export function ScheduleReviewPanel({saved,onSubmitted,prepareOnMount=false}:{saved:SavedSchedule;onSubmitted?:()=>void;prepareOnMount?:boolean}){
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
  useEffect(()=>{if(prepareOnMount)void check(true);},[saved.schedule.id,saved.schedule.version,prepareOnMount]);
  const submit=async()=>{
    if(working.current||!handoff?.delivery.configured||!handoff.validation.can_submit||saved.schedule.status!=='DRAFT')return;
    if(!window.confirm('Gửi lịch đã lưu cho giám sát phê duyệt?'))return;
    working.current=true;setBusy(true);setError('');
    try{
      const key=JSON.stringify([saved.schedule.id,saved.schedule.version,note]);
      if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
      await schedulingService.submitApproval(saved.schedule.id,saved.schedule.version,note,attempt.current!.id);
      if(active.current){setHandoff({...handoff,delivery:{configured:true,sent:true,message:'Đã gửi và lưu trạng thái chờ phê duyệt.'}});onSubmitted?.();}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Không thể gửi lịch.');}
    finally{working.current=false;if(active.current)setBusy(false);}
  };
  return <section className="card summary-panel" aria-label="Gửi lịch phê duyệt" aria-busy={busy}>
    <h3>Gửi lịch phê duyệt</h3>
    <p className="schedule-muted">Trạng thái: {handoff?.delivery.sent?'Chờ phê duyệt':({DRAFT:'Bản nháp',NEEDS_REVISION:'Cần điều chỉnh',PENDING_APPROVAL:'Chờ phê duyệt',APPROVED:'Đã phê duyệt',PUBLISHED:'Đã công bố'}[saved.schedule.status]??saved.schedule.status)}. Gửi duyệt sẽ khóa chỉnh sửa lịch này.</p>
    <label className="mock-edit-note">Ghi chú bàn giao<textarea rows={2} value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setHandoff(null);}}/></label>
    <div className="schedule-review-actions">
      <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void check(false)}>Kiểm tra lịch</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void check(true)}>Chuẩn bị dữ liệu gửi phê duyệt</button>
      <button type="button" className="btn btn-outline" disabled={busy||saved.schedule.status!=='DRAFT'||!handoff?.delivery.configured||!handoff.validation.can_submit||handoff.delivery.sent} onClick={()=>void submit()}>Gửi Giám sát khu vực phê duyệt</button>
    </div>
    <p className="schedule-muted">{!handoff?'Kiểm tra lịch đã lưu trước khi gửi giám sát phê duyệt.':handoff.delivery.configured?'Lịch bị từ chối cần được chỉnh sửa và lưu bản nháp mới trước khi gửi lại.':'Chưa thể gửi lịch trong tuần này. Vui lòng kiểm tra quyền hoặc liên hệ quản trị.'}</p>
    {error&&<div className="schedule-alert schedule-alert-error" role="alert">{error}</div>}
    {validation&&<ScheduleValidationView validation={validation}/>}
    {handoff&&<div className="schedule-alert" role="status">{handoff.validation.can_submit?'Dữ liệu đáp ứng kiểm tra để chuẩn bị bàn giao.':'Chưa thể bàn giao: cần xử lý các vấn đề được liệt kê.'} {handoff.delivery.message}</div>}
  </section>;
}
