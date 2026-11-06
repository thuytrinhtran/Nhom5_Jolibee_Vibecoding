import { useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { schedulingService } from '../../services/scheduling.service';
import { employeeCompetencyService,skillLevels,type CompetencyEmployee } from '../../services/employee-competency.service';
import { weekLabel,dateLabel } from '../../services/scheduling.view';
import type { SchedulingPeriod } from '../../types/scheduling';
import type { ManagerCalendarData,OfficialCalendarData } from '../../types/manager-calendar';
import './OfficialSchedule.css';
import './ManagerPlanner.css';

export function publishedAssignments(data:Pick<ManagerCalendarData,'schedules'|'assignments'>){
 const published=data.schedules.filter(s=>s.status==='PUBLISHED'&&s.published_at).sort((a,b)=>b.version-a.version);
 if(new Set(published.map(s=>s.schedule_group_id)).size>1)throw new Error('Có nhiều lịch công bố trùng tuần. Vui lòng kiểm tra.');
 return data.assignments.filter(a=>a.schedule_id===published[0]?.id&&a.status==='ACTIVE');
}
export async function loadOfficialWeek(period:string,read:(period:string,filters:Record<string,string|number|boolean>)=>Promise<OfficialCalendarData>,current=()=>true){
 const first=await read(period,{page:0,page_size:100,metadata:true});
 const signature=(v:OfficialCalendarData)=>JSON.stringify({period:v.period,schedules:v.schedules,total:v.total});
 const assignments=[...first.assignments];let last=first;
 if(typeof first.total==='number'){
  const pageCount=Math.ceil(first.total/100);
  if(pageCount>1001)throw Error('Lịch quá lớn để tải đầy đủ. Liên hệ quản trị để kiểm tra.');
  for(let page=1;page<pageCount;page+=4){
   if(!current())throw Error('Đã chuyển tuần.');
   const batch=await Promise.all(Array.from({length:Math.min(4,pageCount-page)},(_,i)=>read(period,{page:page+i,page_size:100,metadata:false})));
   if(!current())throw Error('Đã chuyển tuần.');
   for(const result of batch){
    if(signature(result)!==signature(first)||!result.assignments.length)throw Error('Lịch vừa thay đổi trong lúc tải. Bấm Tải lại để xem đầy đủ.');
    assignments.push(...result.assignments);
   }
  }
 }else for(let page=1;last.assignments.length===100;page++){
   if(!current())throw Error('Đã chuyển tuần.');
   if(page>1000)throw Error('Lịch quá lớn để tải đầy đủ. Liên hệ quản trị để kiểm tra.');
   last=await read(period,{page,page_size:100,metadata:false});
   if(signature(last)!==signature(first))throw Error('Lịch vừa thay đổi trong lúc tải. Bấm Tải lại để xem đầy đủ.');
   if(!last.assignments.length){if(typeof first.total!=='number')break;throw Error('Lịch vừa thay đổi trong lúc tải. Bấm Tải lại để xem đầy đủ.');}
   assignments.push(...last.assignments);
 }
 if(new Set(assignments.map(a=>a.id)).size!==assignments.length||(typeof first.total==='number'&&first.total!==assignments.length))throw Error('Dữ liệu phân công không đồng nhất. Bấm Tải lại để kiểm tra.');
 const result={...first,assignments};publishedAssignments(result);return result;
}
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
export function officialShiftHours(start:string,end:string){const duration=minutes(end)-minutes(start);return (duration<=0?duration+1440:duration)/60;}
export function officialDays(start:string){return Array.from({length:7},(_,i)=>{const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});}
type Assignment=OfficialCalendarData['assignments'][number];
// Retain a small view for navigation only. Every visit still revalidates live data.
const retainedViews=new Map<string,{at:number;value:OfficialCalendarData}>();
export function officialShiftGroups(rows:Assignment[]){
 const groups=new Map<string,Assignment[]>();
 for(const row of rows){const key=`${row.department_id}/${row.shift_id}`;groups.set(key,[...(groups.get(key)??[]),row]);}
 return [...groups.values()].sort((a,b)=>(a[0].shift?.start_time??'').localeCompare(b[0].shift?.start_time??''));
}
export function OfficialTimeline({data,day,department,levels={}}:{data:OfficialCalendarData;day:string;department:string;levels?:Record<string,CompetencyEmployee['skill_level']>}){
 const rows=publishedAssignments(data).filter(a=>a.work_date===day&&(!department||a.department_id===department));
 const order=['Bếp','Thu ngân','Phục vụ'];
 const departments=data.departments.filter(d=>!department||d.id===department).sort((a,b)=>{const rank=(s:string)=>order.includes(s)?order.indexOf(s):99;return rank(a.name)-rank(b.name)||a.name.localeCompare(b.name,'vi');});
 return <section className="official-day" aria-label={`Timeline ${dateLabel(day)}`}><p className="ui-help">Mở khối ca để xem nhân viên và giờ làm. Cấp độ là thông tin hồ sơ hiện tại.</p>
 <div className="schedule-timeline-scroll" tabIndex={0} aria-label="Cuộn lịch từ 08:00 đến 22:00"><div className="schedule-timeline official-timeline"><div className="timeline-axis"><span>Bộ phận</span><div>{Array.from({length:15},(_,i)=><span key={i} style={{left:`${i/14*100}%`}}>{String(i+8).padStart(2,'0')}:00</span>)}</div></div>
 {departments.map(d=><section className="official-department" key={d.id}><h4>{d.name}</h4><div className="official-department-track">{!rows.some(r=>r.department_id===d.id)?<p className="official-no-shift">Không có phân công trong ngày.</p>:officialShiftGroups(rows.filter(r=>r.department_id===d.id)).map(group=>{
   const row=group[0],shift=row.shift??data.shifts.find(s=>s.id===row.shift_id);
   const start=shift?minutes(shift.start_time):480,end=shift?minutes(shift.end_time)+(shift.end_time<=shift.start_time?1440:0):1320;
   const left=Math.min(100,Math.max(0,(start-480)/840*100)),right=Math.min(100,Math.max(0,(end-480)/840*100)),outside=start<480||end>1320,unplaced=!shift||right<=left;
   const count=new Set(group.map(a=>a.employee_id)).size;
   return <div className="official-shift-lane" key={row.shift_id}><details className={`official-shift${unplaced?' official-shift-unplaced':''}`} style={{marginLeft:`${unplaced?0:left}%`,width:`${unplaced?100:right-left}%`}}><summary><strong>{shift?.name??'Ca chưa có thông tin'}</strong><span>{shift?`${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)}${end>=1440?' (hôm sau)':''}`:'Chưa có giờ làm'}</span><b>{count} nhân viên</b>{unplaced&&<span>Không đặt trên trục giờ{shift?' · Ngoài khung 08:00–22:00':''}</span>}<small>Xem danh sách</small></summary>
     {outside&&<p className="ui-help">Ca có giờ ngoài khung hiển thị; giờ ghi trên ca là giờ thực tế.</p>}
     <ul className="official-members">{[...group].sort((a,b)=>(a.employee?.full_name??'').localeCompare(b.employee?.full_name??'','vi')).map(a=><li key={a.id}><strong>{a.employee?.full_name??data.employees.find(e=>e.id===a.employee_id)?.full_name??'Chưa có tên nhân viên'}</strong><span>{levels[a.employee_id]?skillLevels[levels[a.employee_id]]?.label??'Chưa có thông tin cấp độ':'Chưa có thông tin cấp độ'}</span><span>{shift?`${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)} · ${officialShiftHours(shift.start_time,shift.end_time).toLocaleString('vi-VN')} giờ`:'Chưa có giờ làm'}</span></li>)}</ul>
   </details></div>;
 })}</div></section>)}
 </div></div></section>;
}
export function OfficialSchedule(){
 const {user}=useAuth(),[params,setParams]=useSearchParams();
 const [weeks,setWeeks]=useState<SchedulingPeriod[]>([]),[week,setWeek]=useState(params.get('period_id')??''),[data,setData]=useState<{key:string;value:OfficialCalendarData}|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[day,setDay]=useState(''),[dept,setDept]=useState('');
 const [levels,setLevels]=useState<{key:string;value:Record<string,CompetencyEmployee['skill_level']>}|null>(null),[levelError,setLevelError]=useState(false);
 const identity=`${user?.id}/${user?.branch_id}`,cacheKey=`${identity}/${week}/${schedulingService.readEpoch?.()??0}`,scope=`${cacheKey}/${reload}`,current=useRef(scope);current.current=scope;
 const heading=useRef<HTMLHeadingElement>(null),focusDay=useRef(false);
 useEffect(()=>{if(focusDay.current){heading.current?.focus();focusDay.current=false;}},[day]);
 useEffect(()=>{let active=true;setWeeks([]);setData(null);setLoading(true);setError('');if(!user?.branch_id){setError('Tài khoản chưa được gán chi nhánh. Liên hệ quản trị.');setLoading(false);return;}
   schedulingService.periods().then(v=>{if(active){const sorted=[...v].sort((a,b)=>a.work_start_date.localeCompare(b.work_start_date));setWeeks(sorted);setWeek(old=>sorted.some(p=>p.id===old)?old:([...sorted].reverse().find(p=>p.schedules.some(s=>s.status==='PUBLISHED'))??sorted[0])?.id??'');if(!v.length)setLoading(false);}}).catch(e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};
 },[identity]);
 useEffect(()=>{if(!week||!weeks.some(w=>w.id===week))return;let active=true;const key=scope,cached=retainedViews.get(cacheKey);setLoading(true);setError('');setData(cached&&Date.now()-cached.at<60000?{key,value:cached.value}:null);
   void loadOfficialWeek(week,(p,f)=>schedulingService.officialCalendar(p,f),()=>active&&current.current===key).then(value=>{if(active&&current.current===key){retainedViews.delete(cacheKey);retainedViews.set(cacheKey,{at:Date.now(),value});if(retainedViews.size>8)retainedViews.delete(retainedViews.keys().next().value!);setData({key,value});}}).catch(e=>{if(active&&current.current===key){retainedViews.delete(cacheKey);setError(e.message);}}).finally(()=>{if(active&&current.current===key)setLoading(false);});return()=>{active=false;};
 },[scope,weeks]);
 useEffect(()=>{if(typeof window==='undefined')return;const refresh=()=>{if(typeof document==='undefined'||document.visibilityState==='visible')setReload(n=>n+1);};window.addEventListener('focus',refresh);window.addEventListener('jollishift:data-changed',refresh);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('jollishift:data-changed',refresh);};},[]);
 useEffect(()=>{let active=true;setLevels(null);setLevelError(false);if(!user?.branch_id)return;
   employeeCompetencyService.list().then(rows=>{if(active)setLevels({key:identity,value:Object.fromEntries(rows.filter(e=>e.branch_id===user.branch_id).map(e=>[e.id,e.skill_level]))});}).catch(()=>{if(active)setLevelError(true);});return()=>{active=false;};
 },[identity,reload]);
 const view=data?.key===scope?data.value:null,all=view?publishedAssignments(view):[],selected=weeks.find(w=>w.id===week),days=selected?officialDays(selected.work_start_date):[];
 const departments=view?.departments??[],filtered=all.filter(a=>!dept||a.department_id===dept),index=weeks.findIndex(w=>w.id===week);
 const chooseWeek=(id:string)=>{setWeek(id);setParams({period_id:id});setDay('');setDept('');};
 const chooseDay=(value:string)=>{focusDay.current=true;setDay(value);};
 return <section className="workspace-page official-schedule"><header className="workspace-heading"><div><h2>Lịch làm việc chính thức</h2><p>Phân công đang có hiệu lực trong lịch đã công bố.</p></div><button className="btn btn-outline" disabled={loading} onClick={()=>setReload(n=>n+1)}>Tải lại</button></header>
 <div className="official-controls"><div className="official-week-picker"><button className="btn btn-outline" disabled={index<=0} title={index<=0?'Không có tuần trước trong danh sách.':undefined} onClick={()=>chooseWeek(weeks[index-1].id)}>Tuần trước</button><label>Tuần làm việc<select value={week} onChange={e=>chooseWeek(e.target.value)}><option value="" disabled>Chọn tuần</option>{weeks.map(p=><option key={p.id} value={p.id}>{weekLabel(p)}</option>)}</select></label><button className="btn btn-outline" disabled={index<0||index>=weeks.length-1} title={index>=weeks.length-1?'Không có tuần sau trong danh sách.':undefined} onClick={()=>chooseWeek(weeks[index+1].id)}>Tuần sau</button></div>
 <label>Bộ phận<select value={dept} onChange={e=>setDept(e.target.value)}><option value="">Tất cả bộ phận</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div>
 {loading&&view&&<p role="status">Đang cập nhật lịch mới nhất…</p>}
 {loading&&!view?<p role="status">Đang tải đầy đủ lịch công bố…</p>:error?<div role="alert" className="schedule-alert schedule-alert-error">{error} <button className="btn btn-outline" onClick={()=>setReload(n=>n+1)}>Thử lại</button></div>:!view?<p>Chưa có tuần làm việc để hiển thị.</p>:!view.schedules.some(s=>s.status==='PUBLISHED'&&s.published_at)?<p>Tuần này chưa có lịch được công bố.</p>:<>
 <nav className="official-days" aria-label="Chế độ xem lịch"><button className="btn btn-outline" aria-pressed={!day} onClick={()=>chooseDay('')}>Toàn tuần</button>{days.map(d=><button className="btn btn-outline" key={d} aria-pressed={day===d} onClick={()=>chooseDay(d)}>{dateLabel(d)}</button>)}</nav>
 <h3 ref={heading} tabIndex={-1} className="official-view-title">{day?`Lịch ngày ${dateLabel(day)}`:'Tổng quan tuần'}</h3>
 {levelError&&day&&<p className="ui-help" role="status">Chưa tải được cấp độ nhân viên. Lịch công bố vẫn hiển thị đầy đủ; bấm Tải lại để thử lại.</p>}
 {!day?<div className="official-week-grid">{days.map(d=>{const rows=filtered.filter(a=>a.work_date===d);return <button className="official-day-card" key={d} onClick={()=>chooseDay(d)}><strong>{dateLabel(d)}</strong><span>{new Set(rows.map(a=>a.employee_id)).size} nhân viên · {rows.length} phân công</span>{departments.filter(dep=>!dept||dep.id===dept).map(dep=><span className="official-week-department" key={dep.id}><b>{dep.name}</b>{officialShiftGroups(rows.filter(a=>a.department_id===dep.id)).map(group=><small key={group[0].shift_id}>{group[0].shift?.name??'Ca chưa có tên'} · {new Set(group.map(a=>a.employee_id)).size} người</small>)}</span>)}{!rows.length&&<small>Không có phân công phù hợp.</small>}<span className="official-day-link">Xem timeline →</span></button>;})}</div>:<OfficialTimeline key={`${scope}/${day}/${dept}`} data={view} day={day} department={dept} levels={levels?.key===identity?levels.value:{}}/>}
 </>}
 </section>;
}
