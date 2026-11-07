import { ScheduleError } from './scheduling.engine.js';
export const isTestWriteScope=(env:NodeJS.ProcessEnv=process.env)=>['integration-test','manual-test'].includes(env.TV3_WRITE_SCOPE_MODE??'');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Approval={branch_id:string;period_ids:string[]};
let cachedRaw:string|undefined,cachedApprovals:Approval[]|null=null;
function approvals(raw:string):Approval[]|null{
 if(raw===cachedRaw)return cachedApprovals;cachedRaw=raw;cachedApprovals=null;
 try{
  const value:unknown=JSON.parse(raw);
  if(!Array.isArray(value)||!value.length||value.length>100)return null;
  if(value.some(row=>!row||typeof row!=='object'||Object.keys(row).some(k=>!['branch_id','period_ids'].includes(k))||typeof row.branch_id!=='string'||!uuid.test(row.branch_id)||!Array.isArray(row.period_ids)||!row.period_ids.length||row.period_ids.length>366||row.period_ids.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))))return null;
  cachedApprovals=value.map(row=>({branch_id:row.branch_id.toLowerCase(),period_ids:row.period_ids.map((id:string)=>id.toLowerCase())}));return cachedApprovals;
 }catch{return null;}
}
// Test-only escape is confined to loopback PostgreSQL harnesses, never Supabase.
export function isLocalTestWriteScope(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.NODE_ENV!=='test'||!['legacy','isolated-test'].includes(env.TV3_WRITE_SCOPE_MODE??'legacy')||env.TV3_WRITE_SCOPE_ENABLED!=='false')return false;
 try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(env.SUPABASE_URL??'').hostname);}catch{return false;}
}
export function draftWriteScopeAllowed(periodId:string,branchId:string|undefined,env:NodeJS.ProcessEnv=process.env):boolean {
 if(isLocalTestWriteScope(env))return true;
 // The mock repository cannot persist real schedules; retain explicit memory-only demos.
 if(env.NODE_ENV==='development'&&env.SCHEDULING_DATA_SOURCE==='mock'&&env.TV3_WRITE_SCOPE_ENABLED!=='true'&&!isTestWriteScope(env))return true;
 if(env.TV3_WRITE_SCOPE_ENABLED!=='true'||!branchId||!uuid.test(branchId)||!uuid.test(periodId))return false;
 const mode=env.TV3_WRITE_SCOPE_MODE??'legacy';
 if(!['legacy','manual-test','integration-test','allowlist'].includes(mode)||!['development','test','production'].includes(env.NODE_ENV??'')||(env.NODE_ENV==='production'&&mode!=='allowlist'))return false;
 const project=env.TV3_WRITE_PROJECT_REF;
 if(!project||!/^[a-z0-9]{20}$/.test(project)||env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')!==`https://${project}.supabase.co`)return false;
 // A supplied allowlist is authoritative: invalid/empty JSON never falls back.
 const allowed=env.TV3_WRITE_SCOPE_ALLOWLIST!==undefined?approvals(env.TV3_WRITE_SCOPE_ALLOWLIST):
  env.TV3_WRITE_BRANCH_ID&&uuid.test(env.TV3_WRITE_BRANCH_ID)&&env.TV3_WRITE_PERIOD_ID&&uuid.test(env.TV3_WRITE_PERIOD_ID)?[{branch_id:env.TV3_WRITE_BRANCH_ID.toLowerCase(),period_ids:[env.TV3_WRITE_PERIOD_ID.toLowerCase()]}]:null;
 return !!allowed?.some(row=>row.branch_id===branchId.toLowerCase()&&row.period_ids.includes(periodId.toLowerCase()));
}
export function requireDraftWriteScope(periodId:string,branchId?:string):void {
 if(!draftWriteScopeAllowed(periodId,branchId))throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Chi nhánh hoặc kỳ chưa được cấp quyền trong cấu hình ghi.');
}
export function requireIntegrationTestWriteScope(periodId:string,branchId?:string):void {requireDraftWriteScope(periodId,branchId);}
