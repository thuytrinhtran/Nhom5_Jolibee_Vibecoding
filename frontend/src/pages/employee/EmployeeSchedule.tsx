import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { employeeScheduleService,weekMonday,addDays,employeeDate,employeeDateTime,requestWindowOpen,vietnamToday,shiftPeriod,type EmployeeWeek } from '../../services/employee-schedule.service';
import '../manager/ManagerSchedule.css';
import './EmployeeWorkspace.css';

export function EmployeeWeekView({data,start,view='week'}:{data:EmployeeWeek;start:string;view?:'week'|'list'}){
 const today=vietnamToday();
 return <>
  {!data.schedules.length?<p className="employee-empty" role="status">Tuần này chưa có lịch được công bố.</p>:!data.assignments.length&&<p role="status">Đã có lịch công bố; bạn chưa được phân công ca trong tuần này.</p>}
  <div className={`employee-calendar employee-calendar--${view}`} aria-label={view==='week'?'Lịch tuần 7 ngày':'Danh sách ca trong tuần'}>
  {Array.from({length:7},(_,i)=>{const day=addDays(start,i),shifts=data.assignments.filter(a=>a.work_date===day).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   return <section className={`employee-calendar-day${day===today?' is-today':''}`} key={day} aria-label={employeeDate(day)}>
    <header><span>{['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ Nhật'][i]}</span><strong>{employeeDate(day)}</strong>{day===today&&<small>Hôm nay</small>}</header>
    <div className="employee-day-content">{!shifts.length?<p className="employee-day-off">{data.schedules.length?'Không có lịch làm việc':'Chưa có lịch'}</p>:shifts.map(a=><details className={`employee-shift employee-shift--${shiftPeriod(a.start_time,a.shift_name)}`} key={a.assignment_id}>
     <summary><span className="employee-shift-period">{({morning:'Ca sáng',afternoon:'Ca chiều',evening:'Ca tối'})[shiftPeriod(a.start_time,a.shift_name)]}</span><span className="employee-shift-name">{a.shift_name}</span><strong>{a.start_time.slice(0,5)}–{a.end_time.slice(0,5)}</strong><span>{a.department_name}</span><small>Xem chi tiết</small></summary>
     <div className="employee-shift-details"><p>{a.shift_name} · {a.department_name}</p><p>{a.branch_name}</p>{a.end_time<a.start_time&&<p>Kết thúc hôm sau</p>}<p>Đã công bố · {employeeDateTime(a.published_at)}</p>
      {a.feedback_deadline_at&&<p>Hạn yêu cầu đổi: {employeeDateTime(a.feedback_deadline_at)}</p>}
      {requestWindowOpen(a)?<Link className="btn btn-outline" to={`/employee/support?tab=request&week_start=${start}&assignment_id=${a.assignment_id}`}>Yêu cầu đổi ca</Link>:<p className="employee-help">Đã hết hạn yêu cầu đổi ca hoặc chưa mở nhận yêu cầu.</p>}
      <Link to={`/employee/support?tab=incident&week_start=${start}&assignment_id=${a.assignment_id}`}>Báo sự cố ca này</Link>
     </div>
    </details>)}</div>
   </section>;
  })}</div>
 </>;
}
export function employeeWeekStats(data:EmployeeWeek,now=Date.now()){
 const hours=data.assignments.reduce((sum,a)=>{const minutes=(time:string)=>{const [h,m,s=0]=time.split(':').map(Number);return h*60+m+s/60;};let duration=minutes(a.end_time)-minutes(a.start_time);if(duration<=0)duration+=1440;return sum+duration/60;},0);
 const next=[...data.assignments].filter(a=>Date.parse(`${a.work_date}T${a.start_time}+07:00`)>=now).sort((a,b)=>(a.work_date+a.start_time).localeCompare(b.work_date+b.start_time))[0];
 return {count:data.assignments.length,hours,next};
}
export function EmployeeSchedule({dashboard=false}:{dashboard?:boolean}={}){
 const {user}=useAuth();
 const [start,setStart]=useState(()=>weekMonday()),[data,setData]=useState<EmployeeWeek|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[expired,setExpired]=useState(false),[reload,setReload]=useState(0);
 const [loadedKey,setLoadedKey]=useState('');
 const [view,setView]=useState<'week'|'list'>('week');
 const key=[user?.id,user?.branch_id,start].join('/'),current=loadedKey===key;
 const stats=current&&data?employeeWeekStats(data):null;
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');setExpired(false);
  employeeScheduleService.week(start).then(value=>{if(active)setData(value);}).catch(e=>{if(active){setError(e instanceof Error?e.message:'Không thể tải lịch.');setExpired(e instanceof ApiError&&e.status===401);}}).finally(()=>{if(active){setLoading(false);setLoadedKey(key);}});
  return()=>{active=false;};
 },[start,reload,user?.id,user?.branch_id]);
 useEffect(()=>{if(typeof window==='undefined'||typeof window.addEventListener!=='function')return;const refresh=()=>{if(typeof document==='undefined'||document.visibilityState==='visible')setReload(n=>n+1);};window.addEventListener('focus',refresh);window.addEventListener('jollishift:data-changed',refresh);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('jollishift:data-changed',refresh);};},[]);
 return <section className={`manager-schedule employee-workspace${dashboard?' employee-calendar-dashboard':''}`} aria-busy={loading||!current}>
  {!dashboard&&<><h2>Lịch làm của tôi</h2><p>Chỉ hiển thị phân công đang có hiệu lực trong lịch đã công bố. Giờ theo Việt Nam.</p></>}
  {dashboard&&<><div className="employee-kpis">
   <article><h2>Số ca {start===weekMonday()?'tuần này':'trong tuần'}</h2><strong>{loading||!current?'…':error?'—':stats?.count??'—'}</strong></article>
   <article><h2>Tổng giờ làm</h2><strong>{loading||!current?'…':error?'—':stats?new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(stats.hours)+' giờ':'—'}</strong></article>
   <article><h2>Ca tiếp theo trong tuần</h2><strong className="employee-next-shift">{loading||!current?'Đang tải…':error?'Không tải được':stats?.next?`${employeeDate(stats.next.work_date)} · ${stats.next.start_time.slice(0,5)}`:'Chưa có ca sắp tới'}</strong>{stats?.next&&!loading&&!error&&<span>{stats.next.shift_name} · {stats.next.department_name}</span>}</article>
  </div><h2 className="employee-calendar-title">Lịch làm của bạn</h2></>}
  <div className="card schedule-controls"><button className="btn btn-outline" onClick={()=>setStart(addDays(start,-7))}>Tuần trước</button><strong>{employeeDate(start)} – {employeeDate(addDays(start,6))}</strong><button className="btn btn-outline" onClick={()=>setStart(addDays(start,7))}>Tuần sau</button><button className="btn btn-outline" onClick={()=>setStart(weekMonday())}>Tuần hiện tại</button><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại</button>{dashboard&&<div className="employee-view-switch" aria-label="Chế độ xem">{(['week','list'] as const).map(mode=><button className="btn btn-outline" key={mode} aria-pressed={view===mode} onClick={()=>setView(mode)}>{mode==='week'?'Lịch tuần':'Danh sách'}</button>)}</div>}</div>
  {!dashboard&&<div className="employee-calendar-toolbar"><div className="employee-view-switch" aria-label="Chế độ xem">{(['week','list'] as const).map(mode=><button className="btn btn-outline" key={mode} aria-pressed={view===mode} onClick={()=>setView(mode)}>{mode==='week'?'Lịch tuần':'Danh sách'}</button>)}</div><p className="employee-legend"><span className="morning">Sáng</span><span className="afternoon">Chiều</span><span className="evening">Tối</span><span>Giờ Việt Nam</span></p></div>}
  {(loading||!current)&&<p role="status">Đang tải lịch làm việc…</p>}
  {current&&error&&<div className="schedule-alert" role="alert">{error} {expired?<Link to="/login">Đăng nhập lại</Link>:<button onClick={()=>setReload(n=>n+1)}>Thử lại</button>}</div>}
  {current&&!loading&&!error&&data&&<EmployeeWeekView data={data} start={start} view={view}/>}
 </section>;
}
