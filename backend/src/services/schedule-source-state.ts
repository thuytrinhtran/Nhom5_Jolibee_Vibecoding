import { supabaseAdmin } from '../config/supabase.js';
export type SourceState='CURRENT'|'CHANGED'|'UNKNOWN';
export interface ScheduleSourceState {source_state:SourceState;source_reason:string|null}
export async function readScheduleSourceState(id:string,branch:string,version:number,hasSnapshot:boolean):Promise<ScheduleSourceState>{
  if(!hasSnapshot)return {source_state:'UNKNOWN',source_reason:'SOURCE_SNAPSHOT_MISSING'};
  const {data,error}=await supabaseAdmin.rpc('tv4_schedule_source_state',{p_schedule_id:id,p_branch_id:branch,p_expected_version:version});
  if(error)return {source_state:'UNKNOWN',source_reason:'SOURCE_CHECK_UNAVAILABLE'};
  if(!data||!['CURRENT','CHANGED','UNKNOWN'].includes(data.source_state))return {source_state:'UNKNOWN',source_reason:'SOURCE_CHECK_UNAVAILABLE'};
  return {source_state:data.source_state,source_reason:typeof data.source_reason==='string'?data.source_reason:null};
}
