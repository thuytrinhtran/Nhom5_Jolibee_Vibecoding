import { createHash } from 'node:crypto';
import { reviewAssignments, scheduleBalance, ScheduleError, type Assignment, type SchedulingInput } from './scheduling.engine.js';

export const alternativePolicy = { maxAttempts: 500, maxInspections: 5000, maxHistory: 64, maxHistoryAssignments: 50000, maxBalanceIncrease: 0, epsilon: 1e-9 };
export function assignmentFingerprint(rows: Assignment[]): string {
  return createHash('sha256').update(JSON.stringify(rows.map(a => [a.employee_id,a.work_date,a.shift_id,a.department_id]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
}
export function parseAlternativeHistory(value: unknown): Assignment[][] {
  const fields=['employee_id','work_date','shift_id','department_id'];
  if(!Array.isArray(value)||value.length>alternativePolicy.maxHistory||value.reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:50001),0)>alternativePolicy.maxHistoryAssignments
    ||value.some(rows=>!Array.isArray(rows)||rows.length>10000||rows.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!fields.includes(k))||fields.some(k=>typeof a[k]!=='string'))))
    throw new ScheduleError(400,'INVALID_ALTERNATIVE_HISTORY','Lịch sử phương án không hợp lệ hoặc vượt giới hạn.');
  return value as Assignment[][];
}
export function findAlternative(input: SchedulingInput, current: Assignment[], history: Assignment[][]) {
  const baseline=reviewAssignments(input,current),balance=scheduleBalance(input,current).objective;
  const seen=new Set([...history,current].map(assignmentFingerprint));
  let attempts=0,inspections=0;
  const test=(rows:Assignment[])=>{
    if(attempts>=alternativePolicy.maxAttempts)return null;
    attempts++;
    if(seen.has(assignmentFingerprint(rows)))return null;
    try {
      const result=reviewAssignments(input,rows);
      if(result.coverage.some((c,i)=>c.assigned_count<baseline.coverage[i].assigned_count||c.missing_experienced_count>baseline.coverage[i].missing_experienced_count))return null;
      if(scheduleBalance(input,rows).objective>balance+alternativePolicy.maxBalanceIncrease+alternativePolicy.epsilon)return null;
      return result;
    } catch(error) { if(error instanceof ScheduleError&&error.status===422)return null;throw error; }
  };
  if(seen.size>=alternativePolicy.maxHistory)return {result:baseline,status:'NOT_FOUND' as const,attempts};
  const employees=[...input.employees].sort((a,b)=>a.id.localeCompare(b.id));
  for(let i=0;i<current.length&&attempts<alternativePolicy.maxAttempts&&inspections<alternativePolicy.maxInspections;i++) {
    const a=current[i];
    for(const e of employees) {
      if(++inspections>alternativePolicy.maxInspections)break;
      if(attempts>=alternativePolicy.maxAttempts)break;
      if(e.id===a.employee_id||e.department_id!==a.department_id||!input.registrations.some(r=>r.employee_id===e.id&&r.work_date===a.work_date&&r.shift_id===a.shift_id&&r.status==='VALID'))continue;
      const result=test(current.map((row,j)=>j===i?{...row,employee_id:e.id}:row));
      if(result)return {result,status:'FOUND' as const,attempts};
    }
  }
  for(let i=0;i<current.length&&attempts<alternativePolicy.maxAttempts&&inspections<alternativePolicy.maxInspections;i++)for(let j=i+1;j<current.length&&attempts<alternativePolicy.maxAttempts&&inspections<alternativePolicy.maxInspections;j++) {
    inspections++;
    if(current[i].employee_id===current[j].employee_id||current[i].department_id!==current[j].department_id)continue;
    const result=test(current.map((a,k)=>({...a,employee_id:k===i?current[j].employee_id:k===j?current[i].employee_id:a.employee_id})));
    if(result)return {result,status:'FOUND' as const,attempts};
  }
  return {result:baseline,status:'NOT_FOUND' as const,attempts};
}
