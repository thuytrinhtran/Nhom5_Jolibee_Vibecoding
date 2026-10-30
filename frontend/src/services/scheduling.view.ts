import type { SavedSchedule, SchedulingContext, SchedulingPeriod } from '../types/scheduling';

export const dateLabel = (date: string) => new Intl.DateTimeFormat('vi-VN', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date(`${date}T12:00:00+07:00`));
export const weekLabel = (period: Pick<SchedulingPeriod, 'work_start_date' | 'work_end_date'>) =>
  `${dateLabel(period.work_start_date)} – ${dateLabel(period.work_end_date)}`;
export const statusLabel = (status: string) => ({ DRAFT: 'Dự kiến', PENDING_APPROVAL: 'Chờ phê duyệt',
  NEEDS_REVISION: 'Cần điều chỉnh', APPROVED: 'Đã phê duyệt', PUBLISHED: 'Đã công bố',
  CLOSED: 'Đã đóng đăng ký', OPEN: 'Đang mở đăng ký', PLANNED: 'Chưa mở đăng ký' }[status] || status);
export function latestSchedule(period: SchedulingPeriod) {
  return [...period.schedules].sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
}
export function scheduleRows(context: SchedulingContext, saved: SavedSchedule | null) {
  // Saved demand is the generation-time snapshot. Count the actual persisted assignments,
  // never the original POST result; Crew Leaders do not satisfy regular staffing demand.
  const requirements = saved?.generation_snapshot?.coverage ?? context.requirements;
  return [...requirements].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.shift_id.localeCompare(b.shift_id) || a.department_id.localeCompare(b.department_id))
    .map(requirement => {
      const assignments = (saved?.assignments ?? []).filter(a => a.work_date === requirement.work_date &&
        a.shift_id === requirement.shift_id && a.department_id === requirement.department_id &&
        a.status !== 'REPLACED' && a.assignment_source !== 'CREW_LEADER');
      return { ...requirement, assignments, assigned_count: assignments.length,
        missing_count: Math.max(0, requirement.required_count - assignments.length) };
    });
}

// Calendar placeholders are view data only: never persisted or passed to the Rule Engine.
export function scheduleCalendarRows(context:SchedulingContext,saved:SavedSchedule|null) {
  const key=(row:{work_date:string;shift_id:string;department_id:string})=>`${row.work_date}/${row.shift_id}/${row.department_id}`;
  const declared=new Map(scheduleRows(context,saved).map(r=>[key(r),r]));
  const cells=new Map<string,{work_date:string;shift_id:string;department_id:string}>();
  const shifts=context.shifts.filter(s=>s.is_active!==false).sort((a,b)=>a.start_time.localeCompare(b.start_time)||a.id.localeCompare(b.id));
  const day=new Date(`${context.period.work_start_date}T00:00:00Z`);
  while(day.toISOString().slice(0,10)<=context.period.work_end_date){
    for(const shift of shifts)for(const department of context.departments){const cell={work_date:day.toISOString().slice(0,10),shift_id:shift.id,department_id:department.id};cells.set(key(cell),cell);}
    day.setUTCDate(day.getUTCDate()+1);
  }
  // Retain historical requirements/assignments even if today's catalog no longer lists them.
  for(const row of declared.values())cells.set(key(row),row);
  const assignments=(saved?.assignments??[]).filter(a=>a.status!=='REPLACED'&&a.assignment_source!=='CREW_LEADER');
  for(const row of assignments)if(!cells.has(key(row)))cells.set(key(row),row);
  return [...cells.values()].map(cell=>{
    const requirement=declared.get(key(cell)),current=context.requirements.find(r=>key(r)===key(cell));
    const assigned=assignments.filter(a=>key(a)===key(cell));
    return {key:key(cell),work_date:cell.work_date,shift_id:cell.shift_id,department_id:cell.department_id,
      requirement_id:requirement?.id??null,required_count:requirement?.required_count??null,required_skill_name:requirement?.required_skill_name??null,
      current_required_count:current?.required_count??null,assignments:assigned,assigned_count:assigned.length,
      missing_count:requirement?Math.max(0,requirement.required_count-assigned.length):null};
  }).sort((a,b)=>a.work_date.localeCompare(b.work_date)||
    (context.shifts.find(s=>s.id===a.shift_id)?.start_time??'').localeCompare(context.shifts.find(s=>s.id===b.shift_id)?.start_time??'')||a.shift_id.localeCompare(b.shift_id)||a.department_id.localeCompare(b.department_id));
}
