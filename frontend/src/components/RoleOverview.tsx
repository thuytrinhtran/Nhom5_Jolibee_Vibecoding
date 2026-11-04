import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { employeeScheduleService,weekMonday,addDays } from '../services/employee-schedule.service';
import { shiftChangeService } from '../services/shift-change.service';
import { scheduleWorkflowApiService } from '../pages/schedules/scheduleWorkflow.api.service';
import { dashboardConfig } from '../dashboard.config';

export function RoleOverview({role}:{role:'NV'|'GS'}){
 const {user}=useAuth(),[week,setWeek]=useState(()=>weekMonday()),[metrics,setMetrics]=useState<[string,number][]|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{if(!user)return;let active=true;setLoading(true);setMetrics(null);setError('');
  const read=async():Promise<[string,number][] >=>{
   if(role==='NV'){const [schedule,queue]=await Promise.all([employeeScheduleService.week(week),shiftChangeService.read()]);return[['Ca chính thức trong tuần',schedule.assignments.length],['Yêu cầu đang xử lý',queue.sources.filter(s=>['PENDING','SEARCHING','REPORTED','IN_PROGRESS'].includes(s.status)).length],['Lời mời cần trả lời',queue.invitations.filter(i=>i.effective_status==='PENDING').length]];}
   const actor={id:user.id,username:user.username,role:user.role,branch_id:user.branch_id};const [pending,history]=await Promise.all([scheduleWorkflowApiService.listSchedules(actor,'pending'),scheduleWorkflowApiService.listSchedules(actor,'history')]);return[['Lịch chờ phê duyệt',pending.filter(s=>s.is_latest).length],['Cửa hàng có lịch chờ duyệt',new Set(pending.filter(s=>s.is_latest).map(s=>s.branch_id)).size],['Lịch trong lịch sử xử lý',history.length]];
  };read().then(v=>{if(active)setMetrics(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[user?.id,user?.branch_id,week,reload,role]);
 return <section className="workspace-page"><header className="workspace-heading"><div><h2>{role==='NV'?'Công việc của tôi':'Tổng quan khu vực'}</h2><p>Xin chào, {user?.employee?.full_name??user?.username}</p></div><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại</button></header>
 {role==='NV'&&<div className="workspace-links"><button className="btn btn-outline" onClick={()=>setWeek(addDays(week,-7))}>Tuần trước</button><strong>{week} – {addDays(week,6)}</strong><button className="btn btn-outline" onClick={()=>setWeek(addDays(week,7))}>Tuần sau</button></div>}
 {loading?<p role="status">Đang tải số liệu…</p>:error?<div role="alert">{error}<button className="btn btn-outline" onClick={()=>setReload(n=>n+1)}>Thử lại</button></div>:<div className="dashboard-metrics">{metrics?.map(([label,value])=><article className="dashboard-metric" key={label}><h3>{label}</h3><p className="workspace-kpi">{value}</p></article>)}</div>}
 <div className="workspace-links">{dashboardConfig[role].actions.filter(a=>!['/supervisor/branches','/supervisor/support'].includes(a.path)).map(a=><Link className="btn btn-outline" key={a.path} to={a.path}>{a.label}</Link>)}</div>
 </section>;
}
