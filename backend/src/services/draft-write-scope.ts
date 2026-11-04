import { ScheduleError } from './scheduling.engine.js';
import { DEV_IMPORT_PROJECT, DEV_IMPORT_BRANCH, DEV_IMPORT_PERIOD } from '../registrations/dev-import-policy.js';
export const MANUAL_TEST_PERIOD='7f48f53e-d707-4a32-9f15-eb32aeb0095a';
export const isTestWriteScope=(env:NodeJS.ProcessEnv=process.env)=>['integration-test','manual-test'].includes(env.TV3_WRITE_SCOPE_MODE??'');
export const INTEGRATION_TEST_PERIOD='0f38b6da-4552-4885-9c0b-dbb295e8ef8c';

// Optional operator restriction. Existing installations retain their normal policy.
export function draftWriteScopeAllowed(periodId:string,branchId:string|undefined,env:NodeJS.ProcessEnv=process.env):boolean {
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
export function requireDraftWriteScope(periodId:string,branchId?:string):void {
  if(!draftWriteScopeAllowed(periodId,branchId))throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Ngoài chi nhánh hoặc kỳ kiểm thử đã được cấu hình.');
}
export function requireIntegrationTestWriteScope(periodId:string,branchId?:string):void {
  if(isTestWriteScope())requireDraftWriteScope(periodId,branchId);
}
