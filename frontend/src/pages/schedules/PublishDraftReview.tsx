import { useEffect, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import { ScheduleReviewPanel } from '../manager/ScheduleReviewPanel';
import type { SavedSchedule } from '../../types/scheduling';
import type { ScheduleWorkflowRecord } from './scheduleWorkflow.types';

export function PublishDraftReview({schedule,onSubmitted,onClose,onBusyChange}:{schedule:ScheduleWorkflowRecord;onSubmitted:()=>void;onClose:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [saved,setSaved]=useState<SavedSchedule|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [sending,setSending]=useState(false);
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    setLoading(true);setSaved(null);setError('');
    const timer=setTimeout(()=>{if(active){active=false;controller.abort();setLoading(false);setError('Hết thời gian tải DRAFT sau 20 giây. Hãy thử lại; lịch chưa được gửi.');}},20000);
    void schedulingService.read(schedule.id,controller.signal).then(result=>{
      if(!active)return;
      const current=result?.schedule;
      if(!current||current.id!==schedule.id||current.version!==schedule.version||current.period_id!==schedule.period_id||current.branch_id!==schedule.branch_id||current.schedule_group_id!==schedule.schedule_group_id||current.status!=='DRAFT'||!schedule.is_latest||result.source==='mock'||result.is_mock)throw new Error('DRAFT đã đổi phiên bản, trạng thái hoặc phạm vi. Hãy tải lại danh sách trước khi gửi.');
      setSaved(result);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được DRAFT. Lịch chưa được gửi.');})
      .finally(()=>{clearTimeout(timer);if(active)setLoading(false);});
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[schedule.id,schedule.version,schedule.period_id,schedule.branch_id,schedule.schedule_group_id,schedule.is_latest,reload]);
  useEffect(()=>{onBusyChange(loading||sending);},[loading,sending,onBusyChange]);
  return <section aria-label={`Gửi DRAFT phiên bản ${schedule.version}`}>
    <p>Tuần {schedule.registration_periods.work_start_date} – {schedule.registration_periods.work_end_date} · DRAFT phiên bản {schedule.version}</p>
    {loading&&<p role="status">Đang tải DRAFT đã lưu…</p>}
    {error&&<div role="alert">Không thể mở bước gửi duyệt: {error} <button className="workflow-button secondary" onClick={()=>setReload(n=>n+1)}>Thử tải lại DRAFT</button></div>}
    {saved&&<ScheduleReviewPanel key={`${saved.schedule.id}/${saved.schedule.version}`} saved={saved} prepareOnMount onBusyChange={setSending} onSubmitted={onSubmitted}/>}
    <button className="workflow-button secondary" disabled={loading||sending} onClick={onClose}>Đóng bước gửi duyệt</button>
  </section>;
}
