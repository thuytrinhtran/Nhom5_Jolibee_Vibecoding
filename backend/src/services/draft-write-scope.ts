import { ScheduleError } from './scheduling.engine.js';
import { DEV_IMPORT_PROJECT, DEV_IMPORT_BRANCH, DEV_IMPORT_PERIOD } from '../registrations/dev-import-policy.js';
export const MANUAL_TEST_PERIOD='7f48f53e-d707-4a32-9f15-eb32aeb0095a';
// An incomplete isolated configuration must never fall back to the legacy policy.
export const isIsolatedWriteScope=(env:NodeJS.ProcessEnv=process.env)=>env.TV3_WRITE_SCOPE_MODE==='isolated-test'
  || ['TV3_TEST_PROJECT_REF','TV3_WRITE_START_DATE','TV3_WRITE_END_DATE'].some(key=>env[key]!==undefined);
export const isTestWriteScope=(env:NodeJS.ProcessEnv=process.env)=>isIsolatedWriteScope(env)||['integration-test','manual-test'].includes(env.TV3_WRITE_SCOPE_MODE??'');
export const INTEGRATION_TEST_PERIOD='0f38b6da-4552-4885-9c0b-dbb295e8ef8c';
export type WritePeriod={id:string;branch_id:string;work_start_date:string;work_end_date:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isolatedTargetAllowed(periodId:string,branchId:string|undefined,env:NodeJS.ProcessEnv):boolean {
  const project=env.TV3_TEST_PROJECT_REF;
  // TV3_TEST_PROJECT_REF is an operator-approved, server-only allowlist entry,
  // separate from the requested write target. The shared project is never eligible.
  if(env.TV3_WRITE_SCOPE_MODE!=='isolated-test'||env.TV3_WRITE_SCOPE_ENABLED!=='true'
    ||!['development','test','production'].includes(env.NODE_ENV??'')
    ||!project||!/^[a-z]{20}$/.test(project)||project===DEV_IMPORT_PROJECT
    ||env.TV3_WRITE_PROJECT_REF!==project
    ||env.TV3_WRITE_START_DATE!=='2026-11-09'||env.TV3_WRITE_END_DATE!=='2026-11-15'
    ||!uuid.test(env.TV3_WRITE_BRANCH_ID??'')||!uuid.test(env.TV3_WRITE_PERIOD_ID??'')
    ||branchId!==env.TV3_WRITE_BRANCH_ID||periodId!==env.TV3_WRITE_PERIOD_ID)return false;
  // Match the complete origin/path, rejecting credentials, query strings and lookalike hosts.
  return env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')===`https://${project}.supabase.co`;
}

// Retain the legacy development policy; production requires the isolated policy.
export function draftWriteScopeAllowed(periodId:string,branchId:string|undefined,env:NodeJS.ProcessEnv=process.env):boolean {
  if(isIsolatedWriteScope(env))return isolatedTargetAllowed(periodId,branchId,env);
  // Production persistence is only supported through the explicit isolated policy.
  if(env.NODE_ENV==='production')return false;
  const integration=isTestWriteScope(env);
  if(integration&&env.TV3_WRITE_SCOPE_ENABLED!=='true')return false;
  if(env.TV3_WRITE_SCOPE_ENABLED===undefined||env.TV3_WRITE_SCOPE_ENABLED==='false')return true;
  if(env.TV3_WRITE_SCOPE_MODE!==undefined&&!['legacy','integration-test','manual-test'].includes(env.TV3_WRITE_SCOPE_MODE))return false;
  const period=env.TV3_WRITE_SCOPE_MODE==='manual-test'?MANUAL_TEST_PERIOD:integration?INTEGRATION_TEST_PERIOD:DEV_IMPORT_PERIOD;
  return env.TV3_WRITE_SCOPE_ENABLED==='true'&&env.NODE_ENV==='development'
    &&env.TV3_WRITE_PROJECT_REF===DEV_IMPORT_PROJECT
    &&env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')===`https://${DEV_IMPORT_PROJECT}.supabase.co`
    &&env.TV3_WRITE_BRANCH_ID===DEV_IMPORT_BRANCH&&env.TV3_WRITE_PERIOD_ID===period
    &&branchId===DEV_IMPORT_BRANCH&&periodId===period;
}
/** Full check against period metadata read from storage, never browser-supplied dates. */
export function draftPeriodWriteScopeAllowed(period:WritePeriod,env:NodeJS.ProcessEnv=process.env):boolean {
  return draftWriteScopeAllowed(period.id,period.branch_id,env)&&(!isIsolatedWriteScope(env)
    ||period.work_start_date===env.TV3_WRITE_START_DATE&&period.work_end_date===env.TV3_WRITE_END_DATE);
}
export function requireDraftPeriodWriteScope(period:WritePeriod):void {
  if(!draftPeriodWriteScopeAllowed(period))throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Project, chi nhánh, kỳ hoặc khoảng ngày nằm ngoài phạm vi kiểm thử được cấu hình.');
}
export function requireDraftWriteScope(periodId:string,branchId?:string):void {
  if(!draftWriteScopeAllowed(periodId,branchId))throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Ngoài chi nhánh hoặc kỳ kiểm thử đã được cấu hình.');
}
export function requireIntegrationTestWriteScope(periodId:string,branchId?:string):void {
  if(isTestWriteScope())requireDraftWriteScope(periodId,branchId);
}
