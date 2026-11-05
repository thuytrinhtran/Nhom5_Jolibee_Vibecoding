import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { schedulingService } from '../../services/scheduling.service';
import type { AIEvaluation, AIReviewResponse, SavedSchedule, SchedulePreview, PreviewAIEvaluation, PreviewAIConfiguration, CheckedPreviewCandidates } from '../../types/scheduling';
import './ScheduleAIPanel.css';

export function previewAIErrorMessage(error:unknown):string {
  const issue=error&&typeof error==='object'?error as {code?:string;status?:number}:{};
  const messages:Record<string,string>={
    AI_RATE_LIMITED:'AI đã đạt hạn mức, vui lòng thử lại sau.',
    AI_PROVIDER_UNAVAILABLE:'AI đang bận, vui lòng thử lại sau.',
    AI_TIMEOUT:'AI phản hồi quá chậm, vui lòng thử lại sau.',
    AI_CONFIGURATION_ERROR:'AI chưa được cấu hình hợp lệ.',
    AI_REQUEST_REJECTED:'Dịch vụ AI từ chối yêu cầu phân tích. Vui lòng liên hệ quản trị viên.',
    AI_INVALID_RESPONSE:'Phản hồi AI chưa đúng định dạng. Vui lòng thử lại sau.',
    AI_NETWORK_ERROR:'Chưa kết nối được dịch vụ AI. Vui lòng thử lại sau.',
    PREVIEW_STALE:'Dữ liệu lịch đã thay đổi. Cần tạo hoặc kiểm tra lại phương án trước khi phân tích.',
    AI_REVIEW_IN_PROGRESS:'Phương án đang được phân tích. Vui lòng chờ rồi thử lại.',
  };
  return (issue.code&&messages[issue.code])||(issue.status===429?messages.AI_RATE_LIMITED:issue.status===504?messages.AI_TIMEOUT:'AI chưa khả dụng. Vui lòng thử lại sau.');
}

export function AIReportView({evaluation,stale,employees=[],compact=false}:{evaluation:AIEvaluation|PreviewAIEvaluation;stale:boolean;employees?:{id:string;full_name:string}[];compact?:boolean}) {
  const text=(value:string)=>value.replace(/\b[EDSK]\d{3}\b/g,code=>{const alias=evaluation.employee_aliases.find(a=>a.code===code);return employees.find(e=>e.id===alias?.employee_id)?.full_name??evaluation.labels.find(l=>l.code===code)?.label??'chưa xác định';}).replace(/\b(?:VALID|OFF|NEW|REGULAR|CREW_TRAINING|CREW_LEADER)\b/g,v=>({VALID:'hợp lệ',OFF:'nghỉ',NEW:'nhân viên mới',REGULAR:'có kinh nghiệm',CREW_TRAINING:'hướng dẫn viên',CREW_LEADER:'trưởng ca'}[v]??v)).replace(/\b[A-Z]+(?:_[A-Z0-9]+)+\b/g,'tiêu chí xếp lịch');
  const seen=new Set<string>();
  const groups=[['Điểm tốt',evaluation.report.good_points],['Cần chú ý',evaluation.report.concerns],['Đề xuất cụ thể',evaluation.report.suggestions.map(s=>s.description+' '+s.reason+(s.rule_check.status==='REJECTED'?' Chưa đáp ứng quy tắc xếp lịch.':''))],['Lưu ý',evaluation.report.limitations]] as const;
  return <div className="ai-report" aria-live="polite">{stale?<p>Hết hiệu lực: lịch đã thay đổi, cần phân tích lại.</p>:<strong>{({SUITABLE:'Phù hợp',NEEDS_ADJUSTMENT:'Cần điều chỉnh',INSUFFICIENT_DATA:'Chưa đủ dữ liệu'})[evaluation.report.conclusion]}</strong>}{!stale&&groups.filter(([title])=>!compact||title==='Đề xuất cụ thể').map(([title,items])=>{const lines=items.map(text).filter(v=>{const key=v.trim().toLocaleLowerCase();if(!key||/[{}]/.test(v)||seen.has(key))return false;seen.add(key);return true;}).slice(0,3);return lines.length?<section key={title}><h4>{title}</h4><ul>{lines.map((line,i)=><li key={i}>{line}</li>)}</ul></section>:null;})}</div>;
}

type RuleSuggestion={key:string;date:string;shift:string;department:string;problem:string;action:string;button:string|null;kind:string;candidateLabel?:string};
export function ruleSuggestions(preview:SchedulePreview,checked:CheckedPreviewCandidates[]=[]):RuleSuggestion[] {
  const cell=(r:{work_date:string;shift_id:string;department_id:string})=>`${r.work_date}/${r.shift_id}/${r.department_id}`;
  const ranked=[...(preview.result.coverage??preview.result.shortages)]
    .filter(r=>r.missing_count>0||(r.missing_experienced_count??0)>0||r.composition_status==='SHORTAGE'||!!r.warning)
    .sort((a,b)=>b.missing_count-a.missing_count||(b.missing_experienced_count??0)-(a.missing_experienced_count??0)||cell(a).localeCompare(cell(b)))
    .map(r=>{
      const required=preview.context?.requirements.some(n=>cell(n)===cell(r)&&n.required_count>0);
      const assigned=preview.result.assignments.some(a=>cell(a)===cell(r));
      const missing=r.missing_count>0,experience=(r.missing_experienced_count??0)>0||r.composition_status==='SHORTAGE';
      const evidence=checked.filter(c=>c.preview===preview&&preview.context?.requirements.find(n=>n.id===c.requirementId&&cell(n)===cell(r))&&(missing?c.replaceIndex===undefined:c.replaceIndex!==undefined)).slice(-1)[0];
      const candidateLabel=evidence?(evidence.count===0?(missing?'Không có ứng viên hợp lệ':'Chưa có người thay cho phân công đã kiểm tra'):evidence.replaceIndex!==undefined?`Có ${evidence.count} ứng viên thay thế`:`Có ${evidence.count} ứng viên bổ sung`):undefined;
      const kind=evidence?.count===0?'no-candidates':evidence&&evidence.replaceIndex!==undefined&&evidence.count>0?'replacement':missing?'shortage':experience?'experience':'review';
      const problem=missing?`Thiếu ${r.missing_count} người${experience?' · cần người có kinh nghiệm':''}`:experience?'Đủ người, thiếu kinh nghiệm':'Cần xem lại cơ cấu nhân sự';
      const action=evidence?.count===0?(missing?'Rà soát đăng ký hoặc liên hệ hỗ trợ từ chi nhánh khác.':'Kiểm tra khả năng thay người ở phân công khác trong ca.'):
        evidence&&evidence.count>0?(experience&&evidence.experiencedCount===0?'Danh sách đã kiểm tra chưa có người kinh nghiệm; xem lại phương án thay người.':'Liên hệ ứng viên đã kiểm tra để xác nhận trước khi thêm hoặc thay người.'):
        missing?'Kiểm tra người đăng ký phù hợp để bổ sung cho ca.':assigned?'Tìm người có kinh nghiệm để xem xét thay phân công hiện tại.':'Xem lại đăng ký và cơ cấu nhân viên của ca.';
      return {key:cell(r),date:r.work_date.split('-').reverse().join('/'),
        shift:preview.context?.shifts.find(s=>s.id===r.shift_id)?.name??'Ca chưa có tên',
        department:preview.context?.departments.find(d=>d.id===r.department_id)?.name??'Bộ phận chưa có tên',
        problem,action,kind,candidateLabel,button:required?'Xem ca':null};
    });
  const unique=ranked.filter((s,i)=>ranked.findIndex(other=>other.key===s.key)===i);
  const selected:RuleSuggestion[]=[];
  for(const suggestion of unique)if(!selected.some(s=>s.kind===suggestion.kind)&&selected.length<3)selected.push(suggestion);
  for(const suggestion of unique)if(!selected.includes(suggestion)&&selected.length<3)selected.push(suggestion);
  return selected;
}
type PanelProps=({saved:SavedSchedule;preview?:never}|{preview:SchedulePreview;saved?:never;previewDirty?:boolean;onOpenCell?:(key:string)=>void;checkedCandidates?:CheckedPreviewCandidates[]})&{employees?:{id:string;full_name:string}[]};
export function PreviewScheduleAIPanel({preview,dirty=false,employees=[],onOpenCell,checkedCandidates=[]}:{preview:SchedulePreview;dirty?:boolean;employees?:{id:string;full_name:string}[];onOpenCell?:(key:string)=>void;checkedCandidates?:CheckedPreviewCandidates[]}) {
  const [configuration,setConfiguration]=useState<PreviewAIConfiguration|null>(null);
  const [last,setLast]=useState<{key:string;evaluation:PreviewAIEvaluation}|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0),submitting=useRef(false);
  const cache=useRef(new Map<string,PreviewAIEvaluation>());
  const [configurationReload,setConfigurationReload]=useState(0);
  const [cooldownUntil,setCooldownUntil]=useState(0);
  useEffect(()=>{
    if(!cooldownUntil)return;
    const timer=setTimeout(()=>setCooldownUntil(0),Math.min(2_147_483_647,Math.max(0,cooldownUntil-Date.now())));
    return()=>clearTimeout(timer);
  },[cooldownUntil]);
  const key=JSON.stringify({period:preview.period.id,revision:preview.input_revision,target:preview.edit_target??null,
    assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  useEffect(()=>{
    let active=true;const request=++sequence.current;submitting.current=false;setBusy(false);setError('');setConfiguration(null);setLoading(true);
    const cached=cache.current.get(key);if(cached)setLast({key,evaluation:cached});
    void schedulingService.previewAIConfiguration().then(value=>{if(active&&sequence.current===request){setConfiguration(value);if((value.retry_after_seconds??0)>0)setCooldownUntil(Date.now()+value.retry_after_seconds!*1000);}})
      .catch(()=>{if(active&&sequence.current===request)setError('AI chưa khả dụng, bạn vẫn có thể xem đề xuất bên dưới.');})
      .finally(()=>{if(active&&sequence.current===request)setLoading(false);});
    return()=>{active=false;sequence.current++;};
  },[key,dirty,configurationReload]);
  const evaluate=async()=>{
    if(dirty||loading||busy||submitting.current)return;
    const cached=cache.current.get(key);if(cached){setLast({key,evaluation:cached});return;}
    if(cooldownUntil>Date.now())return;
    if(!configuration){setConfigurationReload(n=>n+1);return;}
    if(!configuration.configured)return;
    submitting.current=true;setBusy(true);setError('');const request=++sequence.current;
    try{
      const result=await schedulingService.evaluatePreviewAI(preview);
      if(request!==sequence.current)return;
      if(!result)throw Object.assign(new Error('Missing evaluation'),{code:'AI_INVALID_RESPONSE'});
      if(result.status==='NOT_CONFIGURED'){
        setConfiguration({configured:false,model:result.model,message:result.message});
        return;
      }
      if(result.scope!=='preview'||result.persisted!==false||result.input_revision!==preview.input_revision||result.status!=='AVAILABLE'||!result.evaluation||result.evaluation.scope!=='preview'||result.evaluation.input_revision!==result.plan_revision)throw Object.assign(new Error('Invalid evaluation'),{code:'AI_INVALID_RESPONSE'});
      if(cache.current.size>=20)cache.current.delete(cache.current.keys().next().value!);
      cache.current.set(key,result.evaluation);setLast({key,evaluation:result.evaluation});
    }catch(error){if(request===sequence.current){
      setError(previewAIErrorMessage(error));
      const issue=error as {code?:string;status?:number;retryAfterSeconds?:number};
      if(issue?.code==='AI_RATE_LIMITED'||issue?.status===429){const seconds=issue.retryAfterSeconds;setCooldownUntil(Date.now()+(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>0?seconds:60)*1000);}
    }}
    finally{if(request===sequence.current){submitting.current=false;setBusy(false);}}
  };
  const coverage=preview.result.coverage??preview.result.shortages;
  const missing=coverage.reduce((total,row)=>total+Math.max(0,row.missing_count),0);
  const attention=coverage.filter(row=>row.missing_count>0||(row.missing_experienced_count??0)>0||row.composition_status==='SHORTAGE'||!!row.warning);
  const attentionShifts=new Set(attention.map(row=>`${row.work_date}/${row.shift_id}`)).size;
  const missingExperience=coverage.reduce((total,row)=>total+Math.max(0,row.missing_experienced_count??0),0);
  const stale=!!last&&(dirty||last.key!==key);
  const suggestions=ruleSuggestions(preview,checkedCandidates);
  const cooling=cooldownUntil>Date.now()&&!cache.current.has(key);
  return <section className="card summary-panel schedule-ai" aria-labelledby="preview-ai-heading" aria-busy={busy}>
    <div className="schedule-heading"><h3 id="preview-ai-heading">Phân tích & đề xuất cải thiện</h3><button type="button" className="btn btn-outline" disabled={dirty||loading||busy||cooling||configuration?.configured===false} onClick={()=>void evaluate()}>{busy?<Loader2 className="spin" size={16} aria-hidden="true"/>:<Sparkles size={16} aria-hidden="true"/>}{busy?'Đang phân tích…':'Phân tích & đề xuất'}</button></div>
    <div className="ai-rule-statistics" aria-label="Thống kê xếp lịch"><span>Tổng vị trí thiếu: <strong>{missing}</strong></span><span>Ca cần chú ý: <strong>{attentionShifts}</strong></span><span>Vị trí thiếu kinh nghiệm: <strong>{missingExperience}</strong></span></div>
    <p className="schedule-muted">{dirty?'Có thay đổi chưa kiểm tra; số liệu đang theo phương án được kiểm tra gần nhất.':'Đề xuất dựa trên lịch hiện tại; mọi thay đổi cần được quản lý xác nhận.'}</p>
    {!dirty&&(!last||stale)&&<section className="rule-suggestions" aria-label="Đề xuất cần xử lý"><h4>Ưu tiên xử lý</h4>{suggestions.length?<ul className="rule-suggestion-cards">{suggestions.map(s=><li className="rule-suggestion-card" key={s.key}><div className="rule-suggestion-context">{s.date} · {s.shift} · {s.department}</div><strong className="rule-suggestion-problem">{s.problem}</strong>{s.candidateLabel&&<span className="rule-suggestion-candidates">{s.candidateLabel}</span>}<p>{s.action}</p>{s.button&&onOpenCell&&<button type="button" className="btn btn-outline" aria-label={`Xem ca ${s.date} · ${s.shift} · ${s.department}`} onClick={()=>onOpenCell(s.key)}>Xem ca</button>}</li>)}</ul>:<p>Chưa ghi nhận ca thiếu người hoặc cần bổ sung kinh nghiệm.</p>}</section>}
    {busy&&<p className="ai-service-note" role="status">Đang phân tích, tối đa 10 giây.</p>}
    {error&&<p className="ai-service-note" role="alert">{error}</p>}
    {configuration?.configured===false&&<p className="ai-service-note" role="status">AI chưa được cấu hình hợp lệ.</p>}
    {cooling&&<p className="ai-service-note" role="status">Có thể thử AI sau {new Date(cooldownUntil).toLocaleTimeString('vi-VN')}.</p>}
    {last&&<AIReportView evaluation={last.evaluation} stale={stale} employees={employees} compact/>}
  </section>;
}
export function ScheduleAIPanel(props:PanelProps) {
  return props.preview?<PreviewScheduleAIPanel preview={props.preview} dirty={props.previewDirty} employees={props.employees} onOpenCell={props.onOpenCell} checkedCandidates={props.checkedCandidates}/>:<SavedScheduleAIPanel saved={props.saved} employees={props.employees}/>;
}

export function SavedScheduleAIPanel({saved,employees=[]}:{saved:SavedSchedule;employees?:{id:string;full_name:string}[]}) {
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
