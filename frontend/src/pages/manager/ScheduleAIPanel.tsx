import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { schedulingService } from '../../services/scheduling.service';
import type { AIEvaluation, AIReviewResponse, SavedSchedule } from '../../types/scheduling';
import './ScheduleAIPanel.css';

export function AIReportView({evaluation,stale,employees=[]}:{evaluation:AIEvaluation;stale:boolean;employees?:{id:string;full_name:string}[]}) {
  const report=evaluation.report;
  const label=(code:string)=>evaluation.labels.find(l=>l.code===code)?.label||code;
  const employee=(code:string)=>{const alias=evaluation.employee_aliases.find(a=>a.code===code),name=employees.find(e=>e.id===alias?.employee_id)?.full_name;return name?`${code} · ${name}`:code;};
  return <div className={`ai-report ${stale?'ai-report-stale':''}`}>
    <div className="schedule-heading"><strong>{({SUITABLE:'Phù hợp',NEEDS_ADJUSTMENT:'Cần điều chỉnh',INSUFFICIENT_DATA:'Chưa đủ dữ liệu'})[report.conclusion]}</strong><span className={`badge ${stale?'badge-yellow':'badge-slate'}`}>{stale?'Hết hiệu lực':'Tư vấn'} · Phiên bản {evaluation.version}</span></div>
    {stale&&<p className="schedule-alert" role="status">Kết quả AI cũ đã hết hiệu lực. Không dùng để quyết định cho lịch hiện hành; hãy tải lại và đánh giá phiên bản mới.</p>}
    <div className="ai-report-columns">{[['Điểm tốt của lịch',report.good_points],['Những điểm chưa phù hợp',report.concerns],['Dữ liệu hoặc tiêu chí chưa thể đánh giá',report.limitations]].map(([title,values])=><section key={title as string}><h4>{title}</h4>{(values as string[]).length?<ul>{(values as string[]).map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>AI không nêu nội dung.</p>}</section>)}</div>
    <section><h4>Gợi ý điều chỉnh và lý do</h4>{!report.suggestions.length&&<p>AI không đề xuất thay đổi.</p>}{report.suggestions.map((s,i)=><article className="ai-proposal" key={i}><strong>{s.description}</strong><p>{s.reason}</p><p className={s.rule_check.status==='REJECTED'?'ai-rule-rejected':'schedule-muted'}>{s.rule_check.status==='REJECTED'?'Rule Engine từ chối: ':s.rule_check.status==='PASS'?'Rule Engine: ':''}{s.rule_check.message}{s.rule_check.code?` (${s.rule_check.code})`:''}</p>
      {s.candidate_assignments&&<details><summary>Xem phương án đề xuất · {s.candidate_assignments.length} phân công · Chưa áp dụng</summary><div className="schedule-table-scroll"><table className="schedule-table"><thead><tr><th>Ngày</th><th>Ca</th><th>Bộ phận</th><th>Nhân viên</th></tr></thead><tbody>{s.candidate_assignments.map((a,j)=><tr key={j}><td>{a.work_date}</td><td>{label(a.shift_code)}</td><td>{label(a.department_code)}</td><td>{employee(a.employee_code)}</td></tr>)}</tbody></table></div></details>}
    </article>)}</section>
    <details><summary>Thông tin bổ sung từ dữ liệu và cấu hình</summary><ul>{evaluation.missing_criteria.map((v,i)=><li key={i}>{v}</li>)}</ul><p className="schedule-muted">AI nhận mã giả danh E/D/S/K. Tên hiển thị trong phương án được tra cứu tại ứng dụng cho Quản lý ca, không gửi tên sang AI.</p></details>
  </div>;
}

export function ScheduleAIPanel({saved,employees=[]}:{saved:SavedSchedule;employees?:{id:string;full_name:string}[]}) {
  const [current,setCurrent]=useState<AIReviewResponse|null>(null),[last,setLast]=useState<AIEvaluation|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0),submitting=useRef(false);
  useEffect(()=>{
    let active=true,reading=false;submitting.current=false;setBusy(false);setCurrent(null);setLoading(true);setError('');
    const check=async(silent=false)=>{
      if(!active||submitting.current||reading)return;reading=true;const request=++sequence.current;
      try {const result=await schedulingService.aiEvaluation(saved.schedule.id,saved.schedule.version);if(active&&request===sequence.current){setCurrent(result);if(result.evaluation?.report)setLast(result.evaluation);if(!silent)setError('');}}
      catch(err){if(active&&request===sequence.current){setCurrent(null);setError(err instanceof Error?err.message:'Không thể kiểm tra hiệu lực đánh giá AI.');}}
      finally{reading=false;if(active&&request===sequence.current)setLoading(false);}
    };
    void check();
    const focus=()=>void check(true),visible=()=>{if(document.visibilityState==='visible')void check(true);};
    const timer=window.setInterval(focus,30000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);
    return()=>{active=false;sequence.current++;window.clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};
  },[saved.schedule.id,saved.schedule.version,saved.schedule.status,saved.demand_changed]);
  const evaluate=async()=>{
    if(submitting.current||loading||!current?.configured||current.rule_check.hard_constraints!=='PASS'||saved.schedule.status!=='DRAFT'||saved.demand_changed)return;
    submitting.current=true;setBusy(true);setError('');const request=++sequence.current;
    try {
      const result=await schedulingService.evaluateAI(saved.schedule.id,saved.schedule.version);
      if(request!==sequence.current)return;
      const refreshed=result.status==='AVAILABLE'?await schedulingService.aiEvaluation(saved.schedule.id,saved.schedule.version):result;
      if(request!==sequence.current)return;setCurrent(refreshed);if(refreshed.evaluation?.report)setLast(refreshed.evaluation);
    }catch(err){if(request===sequence.current){setCurrent(null);setError(err instanceof Error?err.message:'Không thể đánh giá AI.');}}
    finally{if(request===sequence.current){submitting.current=false;setBusy(false);}}
  };
  const stale=!!last&&(last.schedule_id!==saved.schedule.id||last.version!==saved.schedule.version||saved.schedule.status!=='DRAFT'||saved.demand_changed===true||current?.status!=='AVAILABLE'||current.evaluation?.input_revision!==last.input_revision);
  const allowed=current?.configured&&current.rule_check.hard_constraints==='PASS'&&saved.schedule.status==='DRAFT'&&!saved.demand_changed;
  return <section className="card summary-panel schedule-ai" aria-labelledby="schedule-ai-heading" aria-busy={loading||busy}>
    <div className="schedule-heading"><h3 id="schedule-ai-heading">AI đánh giá và đề xuất lịch làm việc</h3><button type="button" className="btn btn-outline" disabled={!allowed||loading||busy} onClick={()=>void evaluate()}>{busy?<Loader2 className="spin" size={16}/>:<Sparkles size={16}/>} {busy?'AI đang đánh giá…':'AI đánh giá lịch'}</button></div>
    <p className="schedule-muted">AI chỉ tư vấn, không thay thế Rule Engine và quyết định của Quản lý ca. Không tự sửa phân công, gửi phê duyệt hoặc công bố. Mọi điều chỉnh phải được Rule Engine kiểm tra lại trước khi lưu.</p>
    {loading&&<p role="status">Đang kiểm tra cấu hình và hiệu lực đánh giá…</p>}
    {busy&&<p role="status">Đang đánh giá phiên bản {saved.schedule.version}. Lịch vẫn giữ nguyên.</p>}
    {current&&<p role="status">{current.message}{current.model?` · Model: ${current.model}`:''}</p>}
    {current?.status==='NOT_CONFIGURED'&&<p className="schedule-muted">Backend cần provider, model, API key và cấu hình cho phép gửi dữ liệu ra ngoài. Chế độ chưa cấu hình không gửi dữ liệu tới nhà cung cấp AI.</p>}
    {current?.configured&&<p className="schedule-muted">Khi bấm đánh giá, ứng dụng gửi bản tóm tắt bằng mã giả danh tới nhà cung cấp AI được cấu hình ở Backend.</p>}
    {error&&<p className="schedule-alert schedule-alert-error" role="alert">{error} Tải lại tuần để kiểm tra trước khi thử lại.</p>}
    {last&&<AIReportView evaluation={last} stale={stale} employees={employees}/>}
  </section>;
}
