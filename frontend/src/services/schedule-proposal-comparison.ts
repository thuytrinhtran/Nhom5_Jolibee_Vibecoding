import type { AdjustmentProposal, SchedulePreview } from '../types/scheduling';
const slot=(a:{work_date:string;shift_id:string;department_id:string})=>JSON.stringify([a.work_date,a.shift_id,a.department_id]);
export function compareScheduleProposal(preview:SchedulePreview,proposal:AdjustmentProposal) {
 const before=preview.result.assignments,after=proposal.result.assignments;
 const keys=new Map([...before,...after].map(a=>[slot(a),{work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id}]));
 const changes=[...keys].map(([key,cell])=>{
  const old=before.filter(a=>slot(a)===key).map(a=>a.employee_id).sort(),next=after.filter(a=>slot(a)===key).map(a=>a.employee_id).sort();
  return {...cell,before:old,after:next,added:next.filter(id=>!old.includes(id)),removed:old.filter(id=>!next.includes(id))};
 }).filter(c=>c.added.length||c.removed.length).sort((a,b)=>slot(a).localeCompare(slot(b)));
 const involved=new Set(changes.flatMap(c=>[...c.added,...c.removed]));
 for(const s of proposal.result.employee_statistics??[]){const previous=(preview.result.employee_statistics??[]).find(e=>e.employee_id===s.employee_id);if(previous&&(previous.shift_count!==s.shift_count||previous.total_weekly_hours!==s.total_weekly_hours))involved.add(s.employee_id);}
 const employees=[...involved].sort().map(id=>{
  const previous=(preview.result.employee_statistics??[]).find(e=>e.employee_id===id),next=(proposal.result.employee_statistics??[]).find(e=>e.employee_id===id);
  return {employee_id:id,before_shifts:before.filter(a=>a.employee_id===id).length,after_shifts:after.filter(a=>a.employee_id===id).length,before_hours:previous?.total_weekly_hours??null,after_hours:next?.total_weekly_hours??null};
 });
 const coverage=(preview.context.requirements??[]).map(r=>({...r,before:before.filter(a=>slot(a)===slot(r)).length,after:after.filter(a=>slot(a)===slot(r)).length}));
 return {changes,employees,coverage,before_count:before.length,after_count:after.length};
}
