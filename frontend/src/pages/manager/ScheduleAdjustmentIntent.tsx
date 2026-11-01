import { compareScheduleProposal } from '../../services/schedule-proposal-comparison';
﻿import { useEffect, useRef, useState } from 'react';
import type { AdjustmentIntent, AdjustmentProposal, SchedulePreview } from '../../types/scheduling';
import { schedulingService } from '../../services/scheduling.service';

const labels:Record<string,string>={BALANCE_HOURS:'Cân bằng giờ làm',REDUCE_LOAD:'Giảm tải',INCREASE_LOAD:'Tăng phân công',PREFER_AVAILABILITY:'Ưu tiên ngày làm/nghỉ',HIGH:'Cao',NORMAL:'Bình thường',LOW:'Thấp',AVOID_DATE:'Tránh ngày',PREFER_DATE:'Ưu tiên ngày',MAX_WEEKLY_HOURS:'Giới hạn giờ tuần'};
export function ScheduleAdjustmentIntent({preview,dirty=false,onApplied}:{preview:SchedulePreview;dirty?:boolean;onApplied?:(value:SchedulePreview)=>void}) {
 const [wish,setWish]=useState(''),[result,setResult]=useState<{key:string;wish:string;value:AdjustmentIntent}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [proposal,setProposal]=useState<AdjustmentProposal|null>(null);
 const sequence=useRef(0),submitting=useRef(false);
 const live=useRef({preview,dirty,wish,onApplied});live.current={preview,dirty,wish,onApplied};
 const key=JSON.stringify({revision:preview.input_revision,target:preview.edit_target,assignments:preview.result.assignments});
 useEffect(()=>{sequence.current++;submitting.current=false;setBusy(false);setError('');setProposal(null);return()=>{sequence.current++;};},[key,dirty,wish]);
 const aliases=[...preview.context.employees].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map((e,i)=>({...e,code:`E${String(i+1).padStart(3,'0')}`}));
 const name=(code:string)=>{const id=result?.value.employees.find(e=>e.code===code)?.employee_id;return aliases.find(e=>e.id===id)?.full_name??code;};
 const stale=!!result&&(dirty||result.key!==key||result.wish!==wish);
 const analyze=async()=>{
  if(dirty||busy||submitting.current||!wish.trim())return;const request=++sequence.current;submitting.current=true;setBusy(true);setError('');setProposal(null);
  try{const value=await schedulingService.analyzeAdjustment(preview,wish);if(request!==sequence.current)return;if(value.scope!=='preview'||value.persisted!==false||value.input_revision!==preview.input_revision)throw Error('Kết quả không khớp phương án.');setResult({key,wish,value});}
  catch(err){if(request===sequence.current){setError(err instanceof Error?err.message:'Không thể phân tích nguyện vọng.');setResult(null);}}
  finally{if(request===sequence.current){submitting.current=false;setBusy(false);}}
 };
 const propose=async()=>{
  if(dirty||stale||busy||submitting.current||result?.value.status!=='READY'||!result.value.analysis_token)return;
  const request=++sequence.current;submitting.current=true;setBusy(true);setError('');setProposal(null);
  try{const value=await schedulingService.proposeAdjustment(preview,result.value.analysis_token);if(request!==sequence.current)return;if(value.scope!=='adjustment-proposal'||value.persisted!==false||value.applied!==false||value.input_revision!==preview.input_revision||value.base_plan_revision!==result.value.plan_revision)throw Error('Đề xuất không khớp phương án gốc.');setProposal(value);}
  catch(err){if(request===sequence.current)setError(err instanceof Error?err.message:'Chưa tạo được đề xuất. Lịch gốc không thay đổi.');}
  finally{if(request===sequence.current){submitting.current=false;setBusy(false);}}
 };
 const apply=async()=>{
  if(!proposal||dirty||stale||busy||submitting.current||!onApplied)return;
  if(!proposal.proposal_token||!proposal.expires_at||!Number.isFinite(Date.parse(proposal.expires_at))||Date.parse(proposal.expires_at)<=Date.now()){setError('Đề xuất hết hiệu lực. Hãy phân tích và tạo lại đề xuất.');return;}
  const request=++sequence.current,original=preview,originalWish=wish;submitting.current=true;setBusy(true);setError('');
  try{
   const value=await schedulingService.applyAdjustment(preview,proposal);
   if(request!==sequence.current||live.current.preview!==original||live.current.dirty||live.current.wish!==originalWish)return;
   if(value.kind!=='preview'||value.persisted!==false||value.period.id!==preview.period.id||value.period.branch_id!==preview.period.branch_id||value.input_revision!==preview.input_revision||JSON.stringify(value.edit_target??null)!==JSON.stringify(preview.edit_target??null))throw Error('Phản hồi không khớp lịch đang chỉnh sửa. Lịch hiện tại được giữ nguyên.');
   live.current.onApplied?.(value);setProposal(null);setResult(null);
  }catch(err){if(request===sequence.current)setError(err instanceof Error?err.message:'Không thể áp dụng; lịch hiện tại được giữ nguyên.');}
  finally{if(request===sequence.current){submitting.current=false;setBusy(false);}}
 };
 const keep=()=>{sequence.current++;submitting.current=false;setBusy(false);setProposal(null);setError('');};
 return <section className="card summary-panel" aria-labelledby="adjustment-intent-heading" aria-busy={busy}>
  <h3 id="adjustment-intent-heading">Phân tích nguyện vọng điều chỉnh</h3>
  <p className="schedule-muted">Phân tích yêu cầu và tạo đề xuất riêng để xem. Lịch hiện tại được giữ nguyên. Nguyện vọng ưu tiên không được ghi đè quy tắc nghiệp vụ.</p>
  <details><summary>Mã nhân viên của phương án</summary><ul>{aliases.map(e=><li key={e.id}>{e.code} — {e.full_name}</li>)}</ul></details>
  <label htmlFor="schedule-adjustment-wish">Nguyện vọng của quản lý</label>
  <textarea id="schedule-adjustment-wish" rows={3} maxLength={2000} style={{display:'block',width:'100%',boxSizing:'border-box',margin:'8px 0'}} value={wish} onChange={e=>setWish(e.target.value)} placeholder="Ví dụ: Cân bằng giờ làm. Giảm tải cho E001, ưu tiên cao."/>
  <p className="schedule-muted">Dùng mã E để tránh nhầm tên; ngày theo YYYY-MM-DD. Không nhập email, số điện thoại hoặc thông tin cá nhân. Hiện hỗ trợ cân bằng/tăng/giảm tải, ưu tiên hoặc tránh ngày và giới hạn giờ tuần.</p>
  <button type="button" className="btn btn-outline" disabled={dirty||busy||!wish.trim()} onClick={()=>void analyze()}>{busy?'Đang phân tích…':'Phân tích nguyện vọng'}</button>
  {dirty&&<p role="status">Hãy kiểm tra lại phương án trước khi phân tích.</p>}
  {error&&<p className="schedule-alert schedule-alert-error" role="alert">{error}</p>}
  {result&&<div aria-live="polite">{stale&&<p role="status">Kết quả phân tích đã hết hiệu lực. Hãy phân tích lại sau khi kiểm tra phương án.</p>}<p>{result.value.message}</p>
   <p>Mục tiêu: {result.value.objectives.map(o=>labels[o]??o).join(', ')||'Chưa xác định'}</p>
   <p>Nhân viên: {result.value.employee_codes.map(name).join(', ')||'Toàn phương án / chưa xác định'}</p>
   <p>Mức ưu tiên: {labels[result.value.priority]}. Loại: nguyện vọng ưu tiên, không phải quy tắc bắt buộc.</p>
   {!!result.value.limits.length&&<ul>{result.value.limits.map((l,i)=><li key={i}>{labels[l.kind]} — {l.employee_code?name(l.employee_code):'Toàn phương án'}: {l.date??`${l.value} giờ`}</li>)}</ul>}
   <p className="schedule-muted">Kết quả phân tích chưa phải phương án phân công. Đề xuất mới phải được backend kiểm tra; không tự áp dụng hoặc lưu.</p>
   <details><summary>Xem JSON phân tích</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({status:result.value.status,objectives:result.value.objectives,employee_codes:result.value.employee_codes,priority:result.value.priority,limits:result.value.limits,preference_strength:result.value.preference_strength},null,2)}</pre></details>
   {result.value.status==='READY'&&<button type="button" className="btn btn-outline" disabled={dirty||stale||busy||!result.value.analysis_token} onClick={()=>void propose()}>{busy?'Đang xử lý…':'Tạo phương án đề xuất'}</button>}
  </div>}
  {proposal&&<div aria-live="polite"><h4>Phương án đề xuất — chưa áp dụng, chưa lưu</h4>
   <p>{proposal.unchanged?'Giữ phương án gốc hợp lệ; chưa tìm được phương án phù hợp hơn.':'Đã tạo phương án mới riêng biệt.'} Đã phân công {proposal.result.assigned_count}/{proposal.result.required_count}; còn thiếu {proposal.result.shortages.reduce((n,r)=>n+r.missing_count,0)} người theo các nhu cầu đã khai báo.</p>
   <ProposalComparison preview={preview} proposal={proposal}/>
   <ul>{proposal.satisfaction.map((s,i)=><li key={i}>{labels[s.criterion]??s.criterion} ({s.target}): {s.status==='SATISFIED'?'Đáp ứng/cải thiện':s.status==='PARTIAL'?'Đáp ứng một phần':'Chưa đáp ứng'}. {s.reason}</li>)}</ul>
   <details><summary>Xem toàn bộ phân công đề xuất ({proposal.result.assignments.length})</summary><ul>{proposal.result.assignments.map((a,i)=><li key={i}>{a.work_date} · {preview.context.shifts.find(s=>s.id===a.shift_id)?.name??a.shift_id} · {preview.context.departments.find(d=>d.id===a.department_id)?.name??a.department_id} · {preview.context.employees.find(e=>e.id===a.employee_id)?.full_name??a.employee_id}</li>)}</ul></details>
   {!!proposal.blocking_reasons.length&&<details><summary>Ràng buộc gặp trong quá trình tìm đề xuất</summary><ul>{proposal.blocking_reasons.map(r=><li key={r.code}>{r.message} ({r.code})</li>)}</ul></details>}
   <div className="schedule-heading"><button type="button" className="btn btn-primary" disabled={dirty||stale||busy||!proposal.proposal_token||!onApplied} onClick={()=>void apply()}>Áp dụng phương án</button><button type="button" className="btn btn-outline" onClick={keep}>Giữ lịch hiện tại</button></div>
   <p className="schedule-muted">Áp dụng chỉ đưa phương án đã kiểm tra vào editor; không lưu hoặc công bố lịch.</p>
   <ul className="schedule-muted">{proposal.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul>
  </div>}
 </section>;
}

export function ProposalComparison({preview,proposal}:{preview:SchedulePreview;proposal:AdjustmentProposal}) {
 const comparison=compareScheduleProposal(preview,proposal),name=(id:string)=>preview.context.employees.find(e=>e.id===id)?.full_name??id;
 const shift=(id:string)=>{const s=preview.context.shifts.find(s=>s.id===id);return s?`${s.name}${s.start_time&&s.end_time?` (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})`:''}`:id;};
 const department=(id:string)=>preview.context.departments.find(d=>d.id===id)?.name??id;
 const names=(ids:string[])=>ids.map(name).join(', ')||'Chưa phân công';
 return <div><h4>So sánh với lịch hiện tại</h4><p>Tổng lượt phân công: {comparison.before_count} → {comparison.after_count}.</p>
  {!comparison.changes.length?<p>Không có thay đổi phân công.</p>:<div className="schedule-table-scroll"><table className="schedule-table"><caption>Các ca thay đổi phân công</caption><thead><tr><th>Ngày / Ca / Bộ phận</th><th>Lịch hiện tại</th><th>Lịch đề xuất</th><th>Thay đổi</th></tr></thead><tbody>{comparison.changes.map((c,i)=><tr key={i} style={{background:'#fff8e1'}}><td>{c.work_date}<br/>{shift(c.shift_id)}<br/>{department(c.department_id)}</td><td>{names(c.before)}</td><td>{names(c.after)}</td><td>{!!c.removed.length&&<p><strong>Bỏ: </strong><del>{names(c.removed)}</del></p>}{!!c.added.length&&<p><strong>Thêm: </strong><ins>{names(c.added)}</ins></p>}{!!c.removed.length&&!!c.added.length&&<span>Thay nhân viên trong cùng ca</span>}</td></tr>)}</tbody></table></div>}
  {!!comparison.employees.length&&<div className="schedule-table-scroll"><table className="schedule-table"><caption>Ca và giờ của nhân viên liên quan</caption><thead><tr><th>Nhân viên</th><th>Số ca trước → sau</th><th>Giờ tuần trước → sau</th></tr></thead><tbody>{comparison.employees.map(e=><tr key={e.employee_id}><td>{name(e.employee_id)}</td><td>{e.before_shifts} → {e.after_shifts}</td><td>{e.before_hours??'Chưa có dữ liệu'} → {e.after_hours??'Chưa có dữ liệu'}</td></tr>)}</tbody></table></div>}
  <p className="schedule-muted">Số ca tính trong phương án; giờ tuần gồm cả phân công hiện hữu được backend cung cấp.</p>
  <details><summary>Coverage trước và sau theo nhu cầu đã khai báo</summary><div className="schedule-table-scroll"><table className="schedule-table"><thead><tr><th>Ngày / Ca / Bộ phận</th><th>Nhu cầu</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{comparison.coverage.map(c=><tr key={c.id}><td>{c.work_date} · {shift(c.shift_id)} · {department(c.department_id)}</td><td>{c.required_count}</td><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div></details>
 </div>;
}
