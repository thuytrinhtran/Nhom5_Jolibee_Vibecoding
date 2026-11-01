import { useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { employeeScheduleService,weekMonday,addDays,type EmployeeShift } from '../../services/employee-schedule.service';
import { shiftChangeService,type ChangeQueue,type ChangeSource,type Candidate } from '../../services/shift-change.service';
import '../manager/ManagerSchedule.css';

export const changeStatus=(value:string)=>({PENDING:'Chờ xử lý',SEARCHING:'Đang tìm người',APPROVED:'Đã thay người',REJECTED:'Đã từ chối',REPORTED:'Đã báo sự cố',IN_PROGRESS:'Đang xử lý',RESOLVED:'Đã giải quyết',UNRESOLVED:'Không giải quyết',ACCEPTED:'Đã nhận lời',DECLINED:'Đã từ chối lời mời',EXPIRED:'Hết hiệu lực'}[value]??value);
export function ShiftChanges({initialAction='CREATE_REQUEST'}:{initialAction?:'CREATE_REQUEST'|'REPORT'}){
 const {user}=useAuth(),manager=user?.role==='QL';
 const [queueData,setQueue]=useState<ChangeQueue|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[expired,setExpired]=useState(false);
 const [week,setWeek]=useState(()=>weekMonday()),[own,setOwn]=useState<EmployeeShift[]>([]),[assignment,setAssignment]=useState(''),[kind,setKind]=useState(initialAction),[reason,setReason]=useState(''),[proposed,setProposed]=useState('');
 const [selected,setSelected]=useState<ChangeSource|null>(null),[candidates,setCandidates]=useState<Candidate[]>([]),[finding,setFinding]=useState(false),[target,setTarget]=useState(''),[deadline,setDeadline]=useState(''),[decisionReason,setDecisionReason]=useState(''),[refresh,setRefresh]=useState(0);
 const [loadedKey,setLoadedKey]=useState('');
 const identity=[user?.id,user?.branch_id,manager,week].join('/');
 const queue=loadedKey===identity?queueData:null;
 const attempt=useRef<{key:string;id:string}|null>(null),working=useRef(false),epoch=useRef(0);
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:'Không thể xử lý.');setExpired(e instanceof ApiError&&e.status===401);};
 useEffect(()=>{const seq=++epoch.current;setLoading(true);setQueue(null);setOwn([]);setSelected(null);setAssignment('');setError('');
  Promise.all([shiftChangeService.read(),manager?Promise.resolve(null):employeeScheduleService.week(week)]).then(([q,w])=>{if(epoch.current===seq){setQueue(q);setOwn(w?.assignments??[]);}}).catch(e=>{if(epoch.current===seq)fail(e);}).finally(()=>{if(epoch.current===seq){setLoading(false);setLoadedKey(identity);}});
  return()=>{epoch.current++;};
 },[user?.id,user?.branch_id,manager,week,refresh]);
 const candidateAssignment=manager?selected?.original_assignment_id:assignment;
 useEffect(()=>{let active=true;setCandidates([]);setProposed('');setTarget('');setFinding(!!candidateAssignment);
  if(candidateAssignment)void shiftChangeService.candidates(candidateAssignment).then(v=>{if(active)setCandidates(v);}).catch(e=>{if(active)fail(e);}).finally(()=>{if(active)setFinding(false);});
  return()=>{active=false;};
 },[candidateAssignment,user?.id,user?.branch_id]);
 const act=async(action:string,data:Record<string,unknown>)=>{
  if(working.current||!queue?.enabled)return;
  if(manager&&['APPROVE','REJECT'].includes(action)&&!window.confirm(action==='APPROVE'?'Xác nhận thay người làm ca?':'Xác nhận kết quả xử lý yêu cầu?'))return;
  working.current=true;setBusy(true);setError('');setNotice('');const seq=epoch.current;
  const key=JSON.stringify({action,data});if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  try{const result=await shiftChangeService.act(action,data,attempt.current!.id);
   if(epoch.current===seq){setNotice(result.status==='EXPIRED'?'Lời mời đã hết hiệu lực; phân công không thay đổi.':action==='ACCEPT'?'Đã nhận lời; chờ quản lý xác nhận. Phân công chưa thay đổi.':result.composition_shortages?.length?'Đã thay người; lịch còn ô thiếu cơ cấu kinh nghiệm. Hãy kiểm tra bảng lịch.':'Đã ghi nhận kết quả.');setReason('');setDecisionReason('');attempt.current=null;setRefresh(v=>v+1);}
  }catch(e){if(epoch.current===seq)fail(e);}finally{working.current=false;setBusy(false);}
 };
 const disabled=busy||loading||!queue?.enabled;
 const source=selected?{kind:selected.kind,source_id:selected.id}:null;
 const invites=queue?.invitations.filter(i=>i.kind===selected?.kind&&i.source_id===selected?.id)??[];
 const open=selected&&['PENDING','SEARCHING','REPORTED','IN_PROGRESS'].includes(selected.status);
 return <section className="manager-schedule" aria-busy={busy||loading}><h2>{manager?'Xử lý đổi ca và người thay thế':'Đổi ca, báo không thể làm và lời mời'}</h2>
  <p>Chỉ thay người sau khi có xác nhận nhận ca hợp lệ và quản lý phê duyệt. Đây không phải hoán đổi hai chiều.</p>
  <Link to={manager?'/manager/schedule':'/employee/schedule'}>Xem lịch hiện tại</Link>
  <button className="btn btn-outline" disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}>Tải lại</button>
  {loading&&<p role="status">Đang tải yêu cầu và lịch công bố…</p>}
  {error&&<div role="alert" className="schedule-alert">{error} {expired?<Link to="/login">Đăng nhập lại</Link>:<button disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Thử lại</button>}</div>}
  {notice&&<p role="status">{notice}</p>}
  {queue&&!queue.enabled&&<p role="note">Backend chưa bật persistence TV5. Các thao tác ghi đang khóa.</p>}
  {!manager&&queue&&<section className="card"><h3>Gửi yêu cầu từ lịch của tôi</h3>
   <div className="schedule-controls"><button disabled={busy} onClick={()=>setWeek(addDays(week,-7))}>Tuần trước</button><strong>{week} – {addDays(week,6)}</strong><button disabled={busy} onClick={()=>setWeek(addDays(week,7))}>Tuần sau</button></div>
   {!own.length?<p>Tuần này không có ca ACTIVE trong lịch công bố của bạn.</p>:<form onSubmit={e=>{e.preventDefault();void act(kind,{assignment_id:assignment,reason,...(proposed?{proposed_employee_id:proposed}:{})});}}>
    <label>Ca cần xử lý<select required value={assignment} disabled={disabled} onChange={e=>setAssignment(e.target.value)}><option value="">Chọn ca</option>{own.map(a=><option value={a.assignment_id} key={a.assignment_id}>{a.work_date} · {a.shift_name} {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)} · {a.department_name}</option>)}</select></label>
    <label>Loại thông tin<select value={kind} disabled={disabled} onChange={e=>setKind(e.target.value as 'CREATE_REQUEST'|'REPORT')}><option value="CREATE_REQUEST">Yêu cầu đổi ca trong hạn phản hồi</option><option value="REPORT">Báo sự cố không thể làm ca</option></select></label>
    {assignment&&<p>Hạn phản hồi đổi ca: {own.find(a=>a.assignment_id===assignment)?.feedback_deadline_at?new Date(own.find(a=>a.assignment_id===assignment)!.feedback_deadline_at!).toLocaleString('vi-VN'):'Chưa có'}. Báo sự cố là luồng riêng, không tự gia hạn đổi ca.</p>}
    <label>Lý do<textarea required value={reason} disabled={disabled} onChange={e=>setReason(e.target.value)}/></label>
    <label>Đề xuất người thay (không bắt buộc)<select value={proposed} disabled={disabled||finding} onChange={e=>setProposed(e.target.value)}><option value="">Để quản lý tìm người</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.employee_code} · {c.full_name}</option>)}</select></label>
    <button className="btn btn-primary" disabled={disabled||finding||!assignment||!reason.trim()}>Gửi thông tin</button>
   </form>}
  </section>}
  {queue&&<section className="card"><h3>{manager?'Yêu cầu trong chi nhánh':'Yêu cầu của tôi'}</h3>{!queue.sources.length&&<p>Chưa có yêu cầu.</p>}
   {queue.sources.map(s=><div key={`${s.kind}/${s.id}`}><button disabled={busy} onClick={()=>{setSelected(s);setDecisionReason('');setDeadline('');}}>{s.kind==='INCIDENT'?'Sự cố':'Đổi ca'} · {s.work_date} · {s.shift_name} · {s.owner_name} · {changeStatus(s.status)}</button><p>{s.reason}</p>{s.decision_reason&&<p>Kết quả: {s.decision_reason}</p>}{!s.actionable&&<p>Ca đã thay đổi hoặc lịch không còn hiệu lực; không thể phê duyệt thay người.</p>}</div>)}
  </section>}
  {manager&&queue&&selected&&source&&<section className="card"><h3>Xử lý: {selected.work_date} · {selected.shift_name} · {selected.department_name}</h3>
   <p>Phiên bản {selected.version} · Đề xuất ban đầu: {candidates.find(c=>c.id===selected.proposed_employee_id)?.full_name??selected.proposed_employee_id??'Chưa có'}</p>
   {finding&&<p role="status">Đang kiểm tra ứng viên…</p>}
   {open&&selected.actionable&&<form onSubmit={e=>{e.preventDefault();void act('INVITE',{...source,target_employee_id:target,expires_at:new Date(deadline).toISOString()});}}>
    {!finding&&!candidates.length&&<p>Không có ứng viên đáp ứng điều kiện hiện tại; không tự phân công ngoài điều kiện.</p>}
    <label>Ứng viên đủ điều kiện<select required value={target} disabled={disabled||finding} onChange={e=>setTarget(e.target.value)}><option value="">Chọn người</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.employee_code} · {c.full_name} · {c.skill_level}</option>)}</select></label>
    <label>Hạn nhận lời mời<input required type="datetime-local" value={deadline} disabled={disabled} onChange={e=>setDeadline(e.target.value)}/></label>
    <button disabled={disabled||!target||!deadline}>Gửi lời mời nhận ca</button>
   </form>}
   {invites.map(i=><div key={i.id}><p>{i.target_name} · {changeStatus(i.effective_status)} · hạn {new Date(i.expires_at).toLocaleString('vi-VN')}</p>{open&&selected.actionable&&i.status==='ACCEPTED'&&i.valid_when_confirmed&&<button className="btn btn-primary" disabled={disabled} onClick={()=>void act('APPROVE',{...source,invitation_id:i.id})}>Phê duyệt người này</button>}</div>)}
   {open&&invites.some(i=>i.effective_status==='EXPIRED')&&!invites.some(i=>i.status==='ACCEPTED'&&i.valid_when_confirmed)&&<p role="alert">Có lời mời hết hạn và chưa có người nhận hợp lệ. Quản lý cần tìm tiếp hoặc xử lý không giải quyết.</p>}
   {open&&<><button disabled={disabled} onClick={()=>void act('EXPIRE',source)}>Ghi nhận lời mời hết hạn</button><label>Lý do từ chối / không giải quyết<textarea value={decisionReason} disabled={disabled} onChange={e=>setDecisionReason(e.target.value)}/></label><button disabled={disabled||!decisionReason.trim()} onClick={()=>void act('REJECT',{...source,reason:decisionReason})}>Từ chối / không giải quyết</button></>}
  </section>}
  {!manager&&queue&&<section className="card"><h3>Lời mời nhận ca của tôi</h3>{!queue.invitations.length&&<p>Chưa có lời mời.</p>}{queue.invitations.map(i=><div key={i.id}><p>{i.work_date} · {i.shift_name} · {i.start_time.slice(0,5)}–{i.end_time.slice(0,5)} · {i.department_name} · {changeStatus(i.effective_status)}</p><p>Hạn phản hồi: {new Date(i.expires_at).toLocaleString('vi-VN')}</p>{i.effective_status==='PENDING'&&<><button disabled={disabled} onClick={()=>void act('ACCEPT',{invitation_id:i.id})}>Nhận lời mời</button><button disabled={disabled} onClick={()=>void act('DECLINE',{invitation_id:i.id})}>Từ chối lời mời</button></>}</div>)}</section>}
  {finding&&!manager&&<p role="status">Đang kiểm tra người thay thế hợp lệ…</p>}
 </section>;
}
