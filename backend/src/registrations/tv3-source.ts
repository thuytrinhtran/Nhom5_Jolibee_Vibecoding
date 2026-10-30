import type { SupabaseClient } from '@supabase/supabase-js';

export interface RegistrationHeader {
  employee_id: string; status: string; submitted_at: string | null; updated_at: string;
  sample_batch_id: string | null;
}
export interface RegistrationRow {
  id: string; period_id: string; employee_id: string; work_date: string; shift_id: string;
  status: string; submitted_at: string | null;
}
export class RegistrationSourceError extends Error {
  constructor(public code: string) { super('Không đọc được nguồn đăng ký TV2 hiện hành.'); }
}
async function pages<T>(make: (a:number,b:number)=>PromiseLike<{data:unknown[]|null;error:{code?:string}|null}>):Promise<T[]> {
  const result:T[]=[];
  for(let a=0;;a+=500){const r=await make(a,a+499);if(r.error)throw new RegistrationSourceError(r.error.code||'REGISTRATION_READ_FAILED');const batch=(r.data||[]) as T[];result.push(...batch);if(batch.length<500)return result;}
}
/** Read only, no cache. A header revision check prevents mixing two concurrent submissions. */
export async function readTv2Source(db:SupabaseClient,periodId:string) {
  const headers=()=>pages<RegistrationHeader>((a,b)=>db.from('registration_submissions_sourced')
    .select('employee_id,status,submitted_at,updated_at,sample_batch_id').eq('period_id',periodId).order('employee_id').range(a,b));
  const before=await headers();
  const rows=await pages<RegistrationRow>((a,b)=>db.from('shift_registrations')
    .select('id,period_id,employee_id,work_date,shift_id,status,submitted_at').eq('period_id',periodId).eq('status','VALID').order('id').range(a,b));
  const after=await headers();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new RegistrationSourceError('REGISTRATION_CHANGED');
  return {headers:after,rows};
}
/** Same VALID/OFF/sample contract as tv3-contract.sql; no scheduling business rules here. */
export function tv2Availability(
  source:{headers:RegistrationHeader[];rows:RegistrationRow[]},
  period:{id:string;branch_id:string;work_start_date:string;work_end_date:string},
  employees:{id:string;branch_id:string;status:string;skill_level:string;is_active:boolean|null;role:string|null}[],
  shifts:{id:string;is_active:boolean;branch_id?:string|null}[],
) {
  const people=employees.filter(e=>e.branch_id===period.branch_id&&e.status==='ACTIVE'&&e.is_active===true&&e.role==='NV'&&e.skill_level!=='CREW_LEADER');
  const ids=new Set(people.map(e=>e.id));
  const valid=new Map(source.headers.filter(h=>h.status==='VALID'&&h.submitted_at&&!h.sample_batch_id&&ids.has(h.employee_id)).map(h=>[h.employee_id,h]));
  const ca=new Set(shifts.filter(s=>s.is_active&&(s.branch_id==null||s.branch_id===period.branch_id)).map(s=>s.id));
  const seen=new Set<string>();
  const registrations=source.rows.filter(r=>{
    const key=`${r.employee_id}/${r.work_date}/${r.shift_id}`;
    if(r.period_id!==period.id||r.status!=='VALID'||!r.submitted_at||!valid.has(r.employee_id)||!ca.has(r.shift_id)||r.work_date<period.work_start_date||r.work_date>period.work_end_date||seen.has(key))return false;
    seen.add(key);return true;
  });
  const declarations: {employee_id:string;work_date:string;declaration:'SHIFT'|'OFF'|'NOT_SUBMITTED'}[]=[];
  for(const e of people){
    const day=new Date(period.work_start_date+'T00:00:00Z');
    for(;day.toISOString().slice(0,10)<=period.work_end_date;day.setUTCDate(day.getUTCDate()+1)){
      const work_date=day.toISOString().slice(0,10);
      declarations.push({employee_id:e.id,work_date,declaration:!valid.has(e.id)?'NOT_SUBMITTED':registrations.some(r=>r.employee_id===e.id&&r.work_date===work_date)?'SHIFT':'OFF'});
    }
  }
  return {registrations,declarations};
}
