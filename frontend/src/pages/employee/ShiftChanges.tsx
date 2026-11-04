import { useEffect,useRef,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { employeeScheduleService,weekMonday,addDays,employeeDate,employeeDateTime,requestWindowOpen,type EmployeeShift } from '../../services/employee-schedule.service';
import { shiftChangeService,changeStatus,type ChangeQueue,type ChangeSource,type Candidate } from '../../services/shift-change.service';
import '../manager/ManagerSchedule.css';
import './EmployeeWorkspace.css';

export { changeStatus } from '../../services/shift-change.service';
export function ShiftChanges({initialAction='CREATE_REQUEST',historyOnly=false,compact=false}:{initialAction?:'CREATE_REQUEST'|'REPORT';historyOnly?:boolean;compact?:boolean}){
 const {user}=useAuth(),manager=user?.role==='QL';
 const [params]=useSearchParams();
 const requestedWeek=params.get('week_start'),requestedAssignment=params.get('assignment_id');
 const validWeek=requestedWeek&&/^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)&&Number.isFinite(Date.parse(requestedWeek+'T12:00:00Z'))&&weekMonday(new Date(requestedWeek+'T12:00:00Z'))===requestedWeek?requestedWeek:null;
 const [queueData,setQueue]=useState<ChangeQueue|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[expired,setExpired]=useState(false);
 const [week,setWeek]=useState(()=>validWeek??weekMonday()),[own,setOwn]=useState<EmployeeShift[]>([]),[assignment,setAssignment]=useState(''),[reason,setReason]=useState(''),[proposed,setProposed]=useState('');
 const [selected,setSelected]=useState<ChangeSource|null>(null),[candidates,setCandidates]=useState<Candidate[]>([]),[finding,setFinding]=useState(false),[target,setTarget]=useState(''),[deadline,setDeadline]=useState(''),[decisionReason,setDecisionReason]=useState(''),[refresh,setRefresh]=useState(0);
 const [loadedKey,setLoadedKey]=useState('');
 const [step,setStep]=useState(0),[tracking,setTracking]=useState(historyOnly?'all':'open'),[historyPage,setHistoryPage]=useState(0);
 useEffect(()=>{setHistoryPage(0);},[tracking,initialAction]);
 useEffect(()=>{setReason('');setProposed('');setStep(0);},[initialAction]);
 useEffect(()=>{if(validWeek)setWeek(validWeek);},[requestedWeek]);
 const identity=[user?.id,user?.branch_id,manager,week,initialAction].join('/');
 const queue=loadedKey===identity?queueData:null;
 const attempt=useRef<{key:string;id:string}|null>(null),working=useRef(false),epoch=useRef(0);
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:'Không thể xử lý.');setExpired(e instanceof ApiError&&e.status===401);};
 useEffect(()=>{const seq=++epoch.current;setLoading(true);setQueue(null);setOwn([]);setSelected(null);setAssignment('');setStep(0);setError('');
  Promise.all([shiftChangeService.read(),(manager||historyOnly)?Promise.resolve(null):employeeScheduleService.week(week)]).then(([q,w])=>{if(epoch.current===seq){setQueue(q);setOwn(w?.assignments??[]);setAssignment(w?.assignments.some(a=>a.assignment_id===requestedAssignment)?requestedAssignment!:(w?.assignments.some(a=>a.assignment_id===assignment)?assignment:''));}}).catch(e=>{if(epoch.current===seq)fail(e);}).finally(()=>{if(epoch.current===seq){setLoading(false);setLoadedKey(identity);}});
  return()=>{epoch.current++;};
 },[user?.id,user?.branch_id,manager,week,refresh,requestedAssignment,initialAction,historyOnly]);
 const candidateAssignment=manager?selected?.original_assignment_id:initialAction==='REPORT'||historyOnly?undefined:assignment;
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
   if(epoch.current===seq){setNotice(result.status==='EXPIRED'?'Lời mời đã hết hiệu lực; phân công không thay đổi.':action==='ACCEPT'?'Đã nhận lời; chờ quản lý xác nhận. Phân công chưa thay đổi.':result.composition_shortages?.length?'Đã thay người; lịch còn ô thiếu cơ cấu kinh nghiệm. Hãy kiểm tra bảng lịch.':action==='CREATE_REQUEST'?'Đã gửi yêu cầu đổi ca. Chờ quản lý xử lý.':action==='REPORT'?'Đã gửi báo cáo sự cố. Quản lý sẽ tiếp nhận.':'Đã ghi nhận kết quả.');setReason('');setDecisionReason('');attempt.current=null;setRefresh(v=>v+1);}
  }catch(e){if(epoch.current===seq)fail(e);}finally{working.current=false;setBusy(false);}
 };
 const disabled=busy||loading||!queue?.enabled;
 const incident=initialAction==='REPORT';
 const chosen=own.find(a=>a.assignment_id===assignment);
 const withinWindow=!!chosen&&requestWindowOpen(chosen);
 const formAllowed=incident||withinWindow;
 const ownSources=(queue?.sources??[]).filter(s=>manager||historyOnly||s.kind===(incident?'INCIDENT':'REQUEST'));
 const isOpen=(s:ChangeSource)=>['PENDING','SEARCHING','REPORTED','IN_PROGRESS'].includes(s.status);
 const visibleSources=ownSources.filter(s=>tracking==='all'||(tracking==='open'?isOpen(s):!isOpen(s)));
 const historyPages=Math.max(1,Math.ceil(visibleSources.length/6)),safeHistoryPage=Math.min(historyPage,historyPages-1);
 const steps=['Chọn ca','Thông tin','Xác nhận'];
 const source=selected?{kind:selected.kind,source_id:selected.id}:null;
 const invites=queue?.invitations.filter(i=>i.kind===selected?.kind&&i.source_id===selected?.id)??[];
 const open=selected&&['PENDING','SEARCHING','REPORTED','IN_PROGRESS'].includes(selected.status);
 return <section className={`manager-schedule${manager?'':' employee-workspace'}`} aria-busy={busy||loading}>{(!compact||manager)&&<h2>{manager?'Xử lý đổi ca và người thay thế':incident?'Báo cáo sự cố':'Yêu cầu đổi ca'}</h2>}
  {!historyOnly&&<p>{incident&&!manager?'Báo nhanh khi bạn không thể làm ca đã được phân công.': 'Ca làm chỉ thay đổi sau khi người thay nhận lời và quản lý phê duyệt.'}</p>}
  <div className="employee-page-actions"><Link className="btn btn-outline" to={manager?'/manager/schedule':'/employee'}>Xem lịch hiện tại</Link>
  <button className="btn btn-outline" disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}>Tải lại</button></div>
  {loading&&<p role="status">Đang tải yêu cầu và lịch công bố…</p>}
  {error&&<div role="alert" className="schedule-alert">{error} {expired?<Link to="/login">Đăng nhập lại</Link>:<button disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Thử lại</button>}</div>}
  {notice&&<p role="status">{notice}</p>}
  {queue&&!queue.enabled&&<p role="note">Chức năng xử lý đổi ca chưa được bật. Vui lòng liên hệ quản lý.</p>}
  {!manager&&!historyOnly&&queue&&<section className={`card employee-composer${incident?' employee-incident':''}`}>
   <header><h3>{incident?'Ca làm cần hỗ trợ':'Tạo yêu cầu đổi ca'}</h3><p>{incident?'Chọn ca bị ảnh hưởng và mô tả sự cố để quản lý tiếp nhận.':'Chọn ca của bạn, cung cấp lý do rồi kiểm tra trước khi gửi.'}</p></header>
   <div className="employee-week-picker"><button className="btn btn-outline" disabled={busy} onClick={()=>setWeek(addDays(week,-7))}>Tuần trước</button><strong>{employeeDate(week)} – {employeeDate(addDays(week,6))}</strong><button className="btn btn-outline" disabled={busy} onClick={()=>setWeek(addDays(week,7))}>Tuần sau</button></div>
   {!own.length?<p className="employee-empty">Bạn chưa có ca làm trong lịch đã công bố của tuần này.</p>:<>
    {!incident&&<ol className="employee-steps" aria-label="Các bước gửi yêu cầu">{steps.map((label,i)=><li key={label} aria-current={i===step?'step':undefined} className={i<=step?'is-current':''}><span>{i+1}</span>{label}</li>)}</ol>}
    <form className={`employee-form${!incident&&step===1?' employee-form--split':''}`} onSubmit={e=>{e.preventDefault();if(!assignment||!formAllowed)return;if(!incident&&step<2){setStep(n=>n+1);return;}if(reason.trim())void act(incident?'REPORT':'CREATE_REQUEST',{assignment_id:assignment,reason,...(!incident&&proposed?{proposed_employee_id:proposed}:{})});}}>
     {(incident||step===0)&&<label>Ca {incident?'bị ảnh hưởng':'muốn đổi'}<select required value={assignment} disabled={disabled} onChange={e=>setAssignment(e.target.value)}><option value="">Chọn ca từ lịch của tôi</option>{own.map(a=><option value={a.assignment_id} key={a.assignment_id}>{employeeDate(a.work_date)} · {a.shift_name} {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)} · {a.department_name}</option>)}</select></label>}
     {chosen&&<div className="employee-selection"><strong>{employeeDate(chosen.work_date)} · {chosen.shift_name}</strong><span>{chosen.start_time.slice(0,5)}–{chosen.end_time.slice(0,5)} · {chosen.department_name}</span>{!incident&&<small>{withinWindow?'Hạn gửi: '+employeeDateTime(chosen.feedback_deadline_at!):'Đã hết hạn đổi ca hoặc chưa mở nhận yêu cầu.'}</small>}</div>}
     {!incident&&chosen&&!withinWindow&&<p role="status" className="employee-help">Không thể gửi yêu cầu đổi ca này. Nếu không thể làm, hãy <Link to={`/employee/incidents?week_start=${week}&assignment_id=${assignment}`}>báo cáo sự cố</Link> để quản lý xem xét.</p>}
     {(incident||step===1)&&<><label>{incident?'Mô tả sự cố':'Lý do đổi ca'}<textarea required rows={3} value={reason} disabled={disabled} placeholder={incident?'Mô tả tình huống và ảnh hưởng đến ca làm…':'Cho quản lý biết vì sao bạn cần đổi ca…'} onChange={e=>setReason(e.target.value)}/></label>
      {!incident&&<label><span>Người thay thế <small>(không bắt buộc)</small></span><select value={proposed} disabled={disabled||finding} onChange={e=>setProposed(e.target.value)}><option value="">Để quản lý tìm người phù hợp</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.employee_code}</option>)}</select>{finding?<small role="status">Đang kiểm tra người thay phù hợp…</small>:assignment&&!candidates.length&&<small>Chưa có người thay phù hợp tại thời điểm này. Bạn vẫn có thể gửi yêu cầu.</small>}</label>}
     </>}
     {!incident&&step===2&&<div className="employee-confirm"><h4>Kiểm tra yêu cầu</h4><p><strong>Lý do:</strong> {reason}</p><p><strong>Người đề xuất:</strong> {candidates.find(c=>c.id===proposed)?.full_name??'Quản lý tìm người thay'}</p><p>Gửi yêu cầu chưa làm thay đổi lịch của bạn.</p></div>}
     <div className="employee-form-actions">{!incident&&step>0&&<button type="button" className="btn btn-outline" disabled={busy} onClick={()=>setStep(n=>n-1)}>Quay lại</button>}<button className="btn btn-primary" disabled={disabled||!assignment||!formAllowed||(!incident&&step===1&&!reason.trim())||((incident||step===2)&&!reason.trim())}>{busy?'Đang gửi…':incident?'Gửi báo cáo':step===2?'Xác nhận gửi yêu cầu':'Tiếp tục'}</button></div>
    </form></>}
  </section>}
  {queue&&(manager||historyOnly||!compact)&&<section className="card employee-tracking"><header><h3>{manager?'Yêu cầu trong chi nhánh':historyOnly?'Lịch sử yêu cầu':incident?'Theo dõi báo cáo sự cố':'Yêu cầu đã gửi'}</h3><div className="employee-view-switch" aria-label="Lọc trạng thái">{[['open','Đang xử lý'],['done','Đã hoàn tất'],['all','Tất cả']].map(([value,label])=><button className="btn btn-outline" key={value} aria-pressed={tracking===value} onClick={()=>setTracking(value)}>{label} ({ownSources.filter(s=>value==='all'||(value==='open'?isOpen(s):!isOpen(s))).length})</button>)}</div></header>
   {!visibleSources.length&&<p className="employee-empty">Không có {incident&&!manager?'báo cáo':'yêu cầu'} trong nhóm này.</p>}
   <div className="employee-request-list">{visibleSources.slice(safeHistoryPage*6,(safeHistoryPage+1)*6).map(s=><article className="employee-request-card" key={`${s.kind}/${s.id}`}><div className="employee-request-heading"><strong>{employeeDate(s.work_date)} · {s.shift_name}</strong><span className={`employee-status employee-status--${isOpen(s)?'pending':s.status==='REJECTED'||s.status==='UNRESOLVED'?'negative':'done'}`}>{changeStatus(s.status)}</span></div><p>{s.department_name}{manager?' · '+s.owner_name:''}</p><p className="employee-reason">{s.reason}</p>{!manager&&<details className="employee-request-result"><summary>Chi tiết xử lý</summary><p>Loại: {s.kind==='INCIDENT'?'Báo cáo sự cố':'Đổi ca'}</p>{s.created_at&&<p>Đã gửi: {employeeDateTime(s.created_at)}</p>}{s.resolved_at&&<p>Hoàn tất: {employeeDateTime(s.resolved_at)}</p>}<p>{s.decision_reason?'Kết quả: '+s.decision_reason:changeStatus(s.status)}</p></details>}{manager&&s.decision_reason&&<p>Kết quả: {s.decision_reason}</p>}{!s.actionable&&<p className="employee-help">Ca đã thay đổi hoặc lịch không còn hiệu lực.</p>}{manager&&<button className="btn btn-outline" disabled={busy} onClick={()=>{setSelected(s);setDecisionReason('');setDeadline('');}}>{s.kind==='INCIDENT'?'Sự cố':'Đổi ca'} · Xem và xử lý</button>}</article>)}</div>
   {historyPages>1&&<nav className="employee-history-pages" aria-label="Trang lịch sử"><button className="btn btn-outline" disabled={safeHistoryPage===0} onClick={()=>setHistoryPage(safeHistoryPage-1)}>Trước</button><span>{safeHistoryPage+1} / {historyPages}</span><button className="btn btn-outline" disabled={safeHistoryPage+1>=historyPages} onClick={()=>setHistoryPage(safeHistoryPage+1)}>Sau</button></nav>}
  </section>}
  {manager&&queue&&selected&&source&&<section className="card"><h3>Xử lý: {employeeDate(selected.work_date)} · {selected.shift_name} · {selected.department_name}</h3>
   <p>Đề xuất ban đầu: {candidates.find(c=>c.id===selected.proposed_employee_id)?.full_name??'Chưa có đề xuất phù hợp'}</p>
   {finding&&<p role="status">Đang kiểm tra ứng viên…</p>}
   {open&&selected.actionable&&<form onSubmit={e=>{e.preventDefault();void act('INVITE',{...source,target_employee_id:target,expires_at:new Date(deadline).toISOString()});}}>
    {!finding&&!candidates.length&&<p>Không có ứng viên đáp ứng điều kiện hiện tại; không tự phân công ngoài điều kiện.</p>}
    <label>Ứng viên đủ điều kiện<select required value={target} disabled={disabled||finding} onChange={e=>setTarget(e.target.value)}><option value="">Chọn người</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.employee_code} · {c.full_name} · {c.skill_level}</option>)}</select></label>
    <label>Hạn nhận lời mời<input required type="datetime-local" value={deadline} disabled={disabled} onChange={e=>setDeadline(e.target.value)}/></label>
    <button disabled={disabled||!target||!deadline}>Gửi lời mời nhận ca</button>
   </form>}
   {invites.map(i=><div key={i.id}><p>{i.target_name} · {changeStatus(i.effective_status)} · hạn {employeeDateTime(i.expires_at)}</p>{open&&selected.actionable&&i.status==='ACCEPTED'&&i.valid_when_confirmed&&<button className="btn btn-primary" disabled={disabled} onClick={()=>void act('APPROVE',{...source,invitation_id:i.id})}>Phê duyệt người này</button>}</div>)}
   {open&&invites.some(i=>i.effective_status==='EXPIRED')&&!invites.some(i=>i.status==='ACCEPTED'&&i.valid_when_confirmed)&&<p role="alert">Có lời mời hết hạn và chưa có người nhận hợp lệ. Quản lý cần tìm tiếp hoặc xử lý không giải quyết.</p>}
   {open&&<><button disabled={disabled} onClick={()=>void act('EXPIRE',source)}>Ghi nhận lời mời hết hạn</button><label>Lý do từ chối / không giải quyết<textarea value={decisionReason} disabled={disabled} onChange={e=>setDecisionReason(e.target.value)}/></label><button disabled={disabled||!decisionReason.trim()} onClick={()=>void act('REJECT',{...source,reason:decisionReason})}>Từ chối / không giải quyết</button></>}
  </section>}
  {!manager&&!historyOnly&&!incident&&queue&&<details className="card employee-invitations" open={queue.invitations.some(i=>i.effective_status==='PENDING')}><summary>Lời mời nhận ca ({queue.invitations.length})</summary>{!queue.invitations.length&&<p>Chưa có lời mời.</p>}{queue.invitations.map(i=><div className="employee-request-card" key={i.id}><p>{employeeDate(i.work_date)} · {i.shift_name} · {i.start_time.slice(0,5)}–{i.end_time.slice(0,5)} · {i.department_name} · {changeStatus(i.effective_status)}</p><p>Hạn phản hồi: {employeeDateTime(i.expires_at)}</p>{i.effective_status==='PENDING'&&<><button disabled={disabled} onClick={()=>void act('ACCEPT',{invitation_id:i.id})}>Nhận lời mời</button><button disabled={disabled} onClick={()=>void act('DECLINE',{invitation_id:i.id})}>Từ chối lời mời</button></>}</div>)}</details>}
  {finding&&!manager&&<p role="status">Đang kiểm tra người thay thế hợp lệ…</p>}
 </section>;
}
