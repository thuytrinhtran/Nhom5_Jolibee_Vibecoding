import { RegistrationError, validatePreferences, type Preference } from './validation.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const DEV_TEST_REGISTRATION_SCOPE={project:'wlbpprpiieonjrqglicv',branch:'11111111-1111-1111-1111-111111111111',period:'7f48f53e-d707-4a32-9f15-eb32aeb0095a',start:'2026-11-09',end:'2026-11-15'};
export function devTestWindowEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
 if(env.REGISTRATION_DEV_TEST_MODE!=='true')return false;
 if(env.NODE_ENV!=='development'||env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')!==`https://${DEV_TEST_REGISTRATION_SCOPE.project}.supabase.co`)
  throw new RegistrationError('Cấu hình đăng ký kiểm thử không đúng môi trường/project.',503);
 return true;
}
export function usesDevTestWindow(period:{id:string;branch_id:string;work_start_date:string;work_end_date:string},branch:string,env:NodeJS.ProcessEnv=process.env):boolean {
 const s=DEV_TEST_REGISTRATION_SCOPE;
 return devTestWindowEnabled(env)&&branch===s.branch&&period.branch_id===s.branch&&period.id===s.period&&period.work_start_date===s.start&&period.work_end_date===s.end;
}
type Connection={query:(sql:string,args?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>};
// Same transaction/validation/ownership contract as save_employee_registration.
// The existing RPC stays intact; only this dev-only path omits its two clock gates.
export async function saveDevTestRegistration(c:Connection,userId:string,periodId:string,preferences:Preference[],submit:boolean){
 if(!devTestWindowEnabled()||periodId!==DEV_TEST_REGISTRATION_SCOPE.period)throw new RegistrationError('Ngoài phạm vi đăng ký kiểm thử.',403);
 await c.query('BEGIN');
 try{
  await c.query("SET LOCAL timezone='UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
  // Serialize with schedule insert/transition writers before checking the period.
  // Never reopen registration underneath approval or an already published roster.
  await c.query('LOCK TABLE public.schedules IN SHARE MODE');
  const locked=(await c.query("SELECT id FROM public.schedules WHERE period_id=$1 AND status IN ('PENDING_APPROVAL','APPROVED','PUBLISHED') LIMIT 1",[periodId])).rows;
  if(locked.length)throw new RegistrationError('Lịch đã gửi duyệt hoặc công bố; không thể thay đổi nguyện vọng.',409);
  const p=(await c.query('SELECT to_jsonb(p) v FROM public.registration_periods p WHERE id=$1 FOR UPDATE',[periodId])).rows[0]?.v;
  const e=(await c.query('SELECT * FROM public.employees WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
  const u=(await c.query('SELECT role,branch_id,is_active FROM public.users WHERE id=$1 FOR SHARE',[userId])).rows[0];
  if(!p||!e||!u||u.role!=='NV'||!u.is_active||e.status!=='ACTIVE'||e.skill_level==='CREW_LEADER'||u.branch_id!==e.branch_id||!usesDevTestWindow(p,e.branch_id))throw new RegistrationError('Nhân viên không có quyền đăng ký kỳ kiểm thử này.',403);
  if(!Array.isArray(preferences)||preferences.length>500||typeof submit!=='boolean')throw new RegistrationError('Dữ liệu đăng ký không hợp lệ.',400);
  const shifts=(await c.query('SELECT id,start_time,end_time FROM public.shifts WHERE is_active AND (branch_id IS NULL OR branch_id=$1) FOR SHARE',[e.branch_id])).rows;
  const errors=validatePreferences(preferences,shifts,p.work_start_date,p.work_end_date);
  if(errors.length)throw new RegistrationError(errors.join(' '),400);
  const old=(await c.query("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') v FROM public.shift_registrations r WHERE period_id=$1 AND employee_id=$2",[periodId,e.id])).rows[0].v;
  const status=submit?'VALID':'DRAFT';
  // Replacement of this employee's own preferences only, on an explicit web save.
  await c.query('DELETE FROM public.shift_registrations WHERE period_id=$1 AND employee_id=$2',[periodId,e.id]);
  await c.query("INSERT INTO public.shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at) SELECT $1,$2,x.work_date,x.shift_id,$4,CASE WHEN $5 THEN clock_timestamp() ELSE NULL END,clock_timestamp() FROM jsonb_to_recordset($3::jsonb) x(work_date date,shift_id uuid)",[periodId,e.id,JSON.stringify(preferences),status,submit]);
  await c.query("INSERT INTO public.registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at) VALUES($1,$2,$3,'[]',CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,clock_timestamp()) ON CONFLICT(period_id,employee_id) DO UPDATE SET status=excluded.status,errors=excluded.errors,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,sample_batch_id=NULL",[periodId,e.id,status,submit]);
  await c.query("INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data) VALUES($1,'employee_registration',$2,$3,$4::jsonb,$5::jsonb)",[userId,periodId,submit?'SUBMIT':'SAVE_DRAFT',JSON.stringify(old),JSON.stringify({employee_id:e.id,status,preferences,dev_test_window:true,project_ref:DEV_TEST_REGISTRATION_SCOPE.project})]);
  await c.query('COMMIT');return{registration_status:status,errors:[]};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
export async function persistDevTestRegistration(userId:string,periodId:string,preferences:Preference[],submit:boolean){
 if(!devTestWindowEnabled())throw new RegistrationError('Chế độ kiểm thử đang tắt.',409);
 const file=process.env.REGISTRATION_DEV_PG_CONNECTION_FILE,lib=process.env.REGISTRATION_DEV_PG_CLIENT;
 if(!file||!lib||!path.isAbsolute(file)||!path.isAbsolute(lib))throw new RegistrationError('Chưa cấu hình kết nối kiểm thử backend.',503);
 if(!fs.existsSync(file)||!fs.existsSync(lib))throw new RegistrationError('Kết nối đăng ký development chưa sẵn sàng trên máy này. RPC Supabase thông thường vẫn kiểm tra thời hạn; không thể bỏ hạn chỉ bằng giao diện.',503);
 const config=JSON.parse(fs.readFileSync(file,'utf8')),s=DEV_TEST_REGISTRATION_SCOPE;
 const direct=config.host===`db.${s.project}.supabase.co`&&config.user==='postgres';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host??'')&&config.user===`postgres.${s.project}`;
 if(config.connectionString||config.options||config.database!=='postgres'||Number(config.port??5432)!==5432||config.ssl?.rejectUnauthorized!==true||(!direct&&!pooler))throw new RegistrationError('Kết nối kiểm thử sai project hoặc TLS.',503);
 const {Client}=createRequire(__filename)(lib),c=new Client(config);
 try{await c.connect();return await saveDevTestRegistration(c,userId,periodId,preferences,submit);}finally{await c.end();}
}
