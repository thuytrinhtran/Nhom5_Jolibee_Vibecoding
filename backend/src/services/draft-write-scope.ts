import { ScheduleError } from './scheduling.engine.js';
import { DEV_IMPORT_PROJECT, DEV_IMPORT_BRANCH, DEV_IMPORT_PERIOD } from '../registrations/dev-import-policy.js';

// Optional operator restriction. Existing installations retain their normal policy.
export function draftWriteScopeAllowed(periodId:string,branchId:string|undefined,env:NodeJS.ProcessEnv=process.env):boolean {
  if(env.TV3_WRITE_SCOPE_ENABLED===undefined||env.TV3_WRITE_SCOPE_ENABLED==='false')return true;
  return env.TV3_WRITE_SCOPE_ENABLED==='true'&&env.NODE_ENV==='development'
    &&env.TV3_WRITE_PROJECT_REF===DEV_IMPORT_PROJECT
    &&env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')===`https://${DEV_IMPORT_PROJECT}.supabase.co`
    &&env.TV3_WRITE_BRANCH_ID===DEV_IMPORT_BRANCH&&env.TV3_WRITE_PERIOD_ID===DEV_IMPORT_PERIOD
    &&branchId===DEV_IMPORT_BRANCH&&periodId===DEV_IMPORT_PERIOD;
}
export function requireDraftWriteScope(periodId:string,branchId?:string):void {
  if(!draftWriteScopeAllowed(periodId,branchId))throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Chỉ được lưu DRAFT tại Lê Duẩn, kỳ 02–08/11/2026 trong đợt kiểm thử này.');
}
