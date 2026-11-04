import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { schedulingService } from '../../services/scheduling.service';
import { loadManagerOverview,type ManagerOverview } from '../../services/manager-overview.service';
import { statusLabel,weekLabel } from '../../services/scheduling.view';
import type { SchedulingPeriod } from '../../types/scheduling';

export function ManagerDashboard(){
 const {user}=useAuth(),[periods,setPeriods]=useState<SchedulingPeriod[]>([]),[week,setWeek]=useState(''),[data,setData]=useState<ManagerOverview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setData(null);setPeriods([]);setWeek('');setLoading(true);setError('');schedulingService.periods().then(rows=>{if(active){setPeriods(rows);const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});setWeek((rows.find(p=>p.work_start_date<=today&&p.work_end_date>=today)??rows.find(p=>p.schedules.length)??rows[0])?.id??'');if(!rows.length)setLoading(false);}}).catch(e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};},[user?.id,user?.branch_id,retry]);
 useEffect(()=>{if(!week)return;let active=true;setData(null);setLoading(true);setError('');loadManagerOverview(week).then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[week]);
 const cards:[string,number|string|null][]=[['Nhân viên chi nhánh',data?.employee_count??null],['Đã đăng ký ca',data?.registered_employees??null],['Trạng thái lịch',data?data.schedule_status?statusLabel(data.schedule_status):'Chưa lập lịch':null],['Yêu cầu đổi ca chờ xử lý',data?.pending_requests??null],[data?.assignment_kind==='official'?'Phân công chính thức':'Phân công dự kiến',data?.assignment_count??null],['Ô lịch thiếu nhân sự',data?.shortage_cells??null]];
 return <section className="workspace-page"><header className="workspace-heading"><div><h2>Tổng quan cửa hàng</h2><p>{user?.branch_name}</p></div><button className="btn btn-outline" onClick={()=>setRetry(n=>n+1)} disabled={loading}>Tải lại</button></header>
 <label className="workspace-week">Tuần làm việc<select value={week} disabled={!periods.length} onChange={e=>setWeek(e.target.value)}>{!periods.length&&<option value="">Chưa có tuần</option>}{periods.map(p=><option key={p.id} value={p.id}>{weekLabel(p)}</option>)}</select></label>
 {error&&<div role="alert" className="schedule-alert">{error}<button className="btn btn-outline" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></div>}
 <div className="dashboard-metrics" aria-busy={loading}>{cards.map(([label,value])=><article className="dashboard-metric" key={label}><h3>{label}</h3><p className="workspace-kpi">{loading?'Đang tải…':error?'Không tải được':value??'Chưa có dữ liệu'}</p></article>)}</div>
 {!loading&&!periods.length&&!error&&<p>Chưa có tuần làm việc tại chi nhánh.</p>}
 <div className="workspace-links"><Link className="btn btn-primary" to={`/manager/official-schedule?period_id=${week}`}>Xem lịch chính thức</Link><Link className="btn btn-outline" to={`/manager/schedule?period_id=${week}`}>Xếp lịch &amp; AI</Link><Link className="btn btn-outline" to="/manager/shift-requests">Xử lý đổi ca</Link></div>
 </section>;
}
