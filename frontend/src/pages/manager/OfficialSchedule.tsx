import { useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { schedulingService } from '../../services/scheduling.service';
import { weekLabel,dateLabel } from '../../services/scheduling.view';
import type { SchedulingPeriod } from '../../types/scheduling';
import type { ManagerCalendarData,OfficialCalendarData } from '../../types/manager-calendar';

export function publishedAssignments(data:Pick<ManagerCalendarData,'schedules'|'assignments'>){
 const published=data.schedules.filter(s=>s.status==='PUBLISHED'&&s.published_at).sort((a,b)=>b.version-a.version);
 if(new Set(published.map(s=>s.schedule_group_id)).size>1)throw new Error('Có nhiều lịch công bố trùng tuần. Vui lòng kiểm tra.');
 return data.assignments.filter(a=>a.schedule_id===published[0]?.id&&a.status==='ACTIVE');
}
export function OfficialSchedule(){
 const {user}=useAuth(),[params,setParams]=useSearchParams(),[weeks,setWeeks]=useState<SchedulingPeriod[]>([]),[week,setWeek]=useState(params.get('period_id')??''),[data,setData]=useState<OfficialCalendarData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [day,setDay]=useState(''),[shift,setShift]=useState(''),[dept,setDept]=useState(''),[person,setPerson]=useState(''),[page,setPage]=useState(0);
 const catalog=useRef<{key:string;data:OfficialCalendarData}|null>(null);
 useEffect(()=>{let active=true;setData(null);setLoading(true);setError('');schedulingService.periods().then(v=>{if(active){setWeeks(v);setWeek(old=>v.some(p=>p.id===old)?old:(v.find(p=>p.schedules.some(s=>s.status==='PUBLISHED'))??v[0])?.id??'');if(!v.length)setLoading(false);}}).catch(e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};},[user?.id,user?.branch_id]);
 useEffect(()=>{if(!week)return;let active=true;setLoading(true);setError('');const key=[user?.id,user?.branch_id,week,reload].join('/');
  schedulingService.officialCalendar(week,{page,page_size:20,work_date:day,shift_id:shift,department_id:dept,employee_id:person,metadata:catalog.current?.key!==key}).then(v=>{if(active){publishedAssignments(v);const old=catalog.current?.key===key?catalog.current.data:null;const merged=v.metadata_included===false&&old?{...v,employees:old.employees,departments:old.departments,shifts:old.shifts}:v;catalog.current={key,data:merged};setData(merged);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[week,reload,user?.id,user?.branch_id,day,shift,dept,person,page]);
 const all=data?publishedAssignments(data):[],rows=all.filter(a=>(!day||a.work_date===day)&&(!shift||a.shift_id===shift)&&(!dept||a.department_id===dept)&&(!person||a.employee_id===person)).sort((a,b)=>a.work_date.localeCompare(b.work_date)||(a.shift?.start_time??'').localeCompare(b.shift?.start_time??'')||(a.employee?.full_name??'').localeCompare(b.employee?.full_name??''));
 const serverPaged=typeof data?.total==='number',total=serverPaged?data!.total!:rows.length;
 const visible=serverPaged?rows:rows.slice(page*20,(page+1)*20);
 const days=data?.period.work_start_date?Array.from({length:7},(_,i)=>{const d=new Date(data.period.work_start_date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);}):[...new Set(all.map(a=>a.work_date))].sort();
 const change=(setter:(v:string)=>void)=>(e:React.ChangeEvent<HTMLSelectElement>)=>{setter(e.target.value);setPage(0);};
 return <section className="workspace-page"><header className="workspace-heading"><div><h2>Lịch làm việc chính thức</h2><p>Chỉ lịch đã công bố, bao gồm những ca đã được duyệt thay người.</p></div><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại</button></header>
 <div className="workspace-filters"><label>Tuần<select value={week} onChange={e=>{setPage(0);setWeek(e.target.value);setParams({period_id:e.target.value});setDay('');setShift('');setDept('');setPerson('');}}>{weeks.map(p=><option key={p.id} value={p.id}>{weekLabel(p)}</option>)}</select></label>
 <label>Ngày<select value={day} onChange={change(setDay)}><option value="">Tất cả ngày</option>{days.map(d=><option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
 <label>Ca<select value={shift} onChange={change(setShift)}><option value="">Tất cả ca</option>{data?.shifts.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>Bộ phận<select value={dept} onChange={change(setDept)}><option value="">Tất cả bộ phận</option>{data?.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
 <label>Nhân viên<select value={person} onChange={change(setPerson)}><option value="">Tất cả nhân viên</option>{data?.employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label></div>
 {loading?<p role="status">Đang tải lịch…</p>:error?<p role="alert">{error}</p>:!total?<p>Tuần này chưa có lịch được công bố.</p>:<><p>{total} phân công phù hợp · Đã công bố</p><div className="workspace-table"><table><thead><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Bộ phận</th></tr></thead><tbody>{visible.map(a=><tr key={a.id}><td>{dateLabel(a.work_date)}</td><td>{a.shift?.name} · {a.shift?.start_time.slice(0,5)}–{a.shift?.end_time.slice(0,5)}</td><td>{a.employee?.full_name}</td><td>{data?.departments.find(d=>d.id===a.department_id)?.name}</td></tr>)}</tbody></table></div><nav className="workspace-pagination" aria-label="Phân trang lịch"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Trước</button><span>Trang {page+1}/{Math.max(1,Math.ceil(total/20))}</span><button disabled={(page+1)*20>=total} onClick={()=>setPage(p=>p+1)}>Sau</button></nav></>}
 </section>;
}
