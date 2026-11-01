import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/auth.service';
import { employeeScheduleService,weekMonday,addDays,type EmployeeWeek } from '../../services/employee-schedule.service';
import '../manager/ManagerSchedule.css';

export function EmployeeWeekView({data,start}:{data:EmployeeWeek;start:string}){
 return <>
  {!data.schedules.length?<p role="status">Tuần này chưa có lịch được công bố.</p>:!data.assignments.length&&<p role="status">Đã có lịch công bố; bạn chưa được phân công ca trong tuần này.</p>}
  {Array.from({length:7},(_,i)=>{const day=addDays(start,i),shifts=data.assignments.filter(a=>a.work_date===day);
   return <section className="card" key={day}><h3>{['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ Nhật'][i]} · {day}</h3>
    {!shifts.length?<p className="schedule-muted">Không có lịch làm việc</p>:shifts.map(a=><details key={a.assignment_id}>
     <summary>{a.shift_name} · {a.start_time.slice(0,5)}–{a.end_time.slice(0,5)}{a.end_time<a.start_time?' (kết thúc hôm sau)':''} · {a.department_name}</summary>
     <p>Chi nhánh: {a.branch_name} · Bộ phận: {a.department_name}</p><p>Lịch công bố phiên bản {a.version} · {new Date(a.published_at).toLocaleString('vi-VN')}</p>
     {a.feedback_deadline_at&&<p>Thời hạn phản hồi: {new Date(a.feedback_deadline_at).toLocaleString('vi-VN')}</p>}
    </details>)}
   </section>;
  })}
 </>;
}
export function EmployeeSchedule(){
 const {user}=useAuth();
 const [start,setStart]=useState(()=>weekMonday()),[data,setData]=useState<EmployeeWeek|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[expired,setExpired]=useState(false),[reload,setReload]=useState(0);
 const [loadedKey,setLoadedKey]=useState('');
 const key=[user?.id,user?.branch_id,start].join('/'),current=loadedKey===key;
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');setExpired(false);
  employeeScheduleService.week(start).then(value=>{if(active)setData(value);}).catch(e=>{if(active){setError(e instanceof Error?e.message:'Không thể tải lịch.');setExpired(e instanceof ApiError&&e.status===401);}}).finally(()=>{if(active){setLoading(false);setLoadedKey(key);}});
  return()=>{active=false;};
 },[start,reload,user?.id,user?.branch_id]);
 return <section className="manager-schedule" aria-busy={loading||!current}><h2>Lịch làm của tôi</h2><p>Chỉ hiển thị phân công đang có hiệu lực trong lịch đã công bố. Giờ theo Việt Nam.</p>
  <div className="card schedule-controls"><button className="btn btn-outline" onClick={()=>setStart(addDays(start,-7))}>Tuần trước</button><strong>{start} – {addDays(start,6)}</strong><button className="btn btn-outline" onClick={()=>setStart(addDays(start,7))}>Tuần sau</button><button className="btn btn-outline" onClick={()=>setStart(weekMonday())}>Tuần hiện tại</button><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại</button></div>
  {(loading||!current)&&<p role="status">Đang tải lịch làm việc…</p>}
  {current&&error&&<div className="schedule-alert" role="alert">{error} {expired?<Link to="/login">Đăng nhập lại</Link>:<button onClick={()=>setReload(n=>n+1)}>Thử lại</button>}</div>}
  {current&&!loading&&!error&&data&&<EmployeeWeekView data={data} start={start}/>}
 </section>;
}
