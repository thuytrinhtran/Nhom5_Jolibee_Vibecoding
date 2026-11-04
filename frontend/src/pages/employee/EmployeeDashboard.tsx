import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { shiftChangeService,changeStatus,type ChangeSource } from '../../services/shift-change.service';
import { employeeDate,employeeDateTime } from '../../services/employee-schedule.service';
import { EmployeeSchedule } from './EmployeeSchedule';

export function recentRequests(sources:ChangeSource[]){return [...sources].sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??'')).slice(0,3);}
export function RecentEmployeeRequests(){
 const {user}=useAuth(),[items,setItems]=useState<ChangeSource[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[loadedKey,setLoadedKey]=useState('');
 const key=[user?.id,user?.branch_id].join('/'),current=key===loadedKey;
 useEffect(()=>{let active=true;setLoading(true);setError('');setItems([]);
  shiftChangeService.read().then(q=>{if(active)setItems(recentRequests(q.sources));}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được yêu cầu.');}).finally(()=>{if(active){setLoading(false);setLoadedKey(key);}});
  return()=>{active=false;};
 },[user?.id,user?.branch_id,reload]);
 return <section className="employee-recent card" aria-busy={loading||!current}><header><h2>Yêu cầu gần đây</h2><div><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại yêu cầu</button><Link to="/employee/support?tab=history">Xem tất cả</Link></div></header>
  {loading||!current?<p role="status">Đang tải yêu cầu…</p>:error?<p role="alert">{error}</p>:!items.length?<p className="employee-help">Bạn chưa gửi yêu cầu nào.</p>:<div className="employee-recent-list">{items.map(s=><Link key={`${s.kind}/${s.id}`} to="/employee/support?tab=history" className="employee-recent-item"><div><strong>{s.kind==='INCIDENT'?'Báo cáo sự cố':'Đổi ca'} · {employeeDate(s.work_date)}</strong><span>{s.shift_name} · {s.department_name}</span>{s.created_at&&<small>Đã gửi {employeeDateTime(s.created_at)}</small>}</div><span className={`employee-status employee-status--${['PENDING','SEARCHING','REPORTED','IN_PROGRESS'].includes(s.status)?'pending':s.status==='REJECTED'||s.status==='UNRESOLVED'?'negative':'done'}`}>{changeStatus(s.status)}</span></Link>)}</div>}
 </section>;
}
export function EmployeeDashboard(){return <div className="employee-dashboard employee-workspace"><EmployeeSchedule dashboard/><RecentEmployeeRequests/></div>;}
