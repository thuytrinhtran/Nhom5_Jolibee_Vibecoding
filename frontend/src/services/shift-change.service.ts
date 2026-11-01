import { authorized } from './auth.service';
export type SourceKind='REQUEST'|'INCIDENT';
export interface ChangeSource {kind:SourceKind;id:string;original_assignment_id:string;reason:string;status:string;work_date:string;shift_name:string;start_time:string;end_time:string;department_name:string;owner_name:string;proposed_employee_id:string|null;decision_reason:string|null;actionable:boolean;version:number}
export interface ReplacementInvite {id:string;source_id:string;kind:SourceKind;target_name:string;status:string;effective_status:string;work_date:string;shift_name:string;start_time:string;end_time:string;department_name:string;expires_at:string;valid_when_confirmed:boolean|null}
export interface Candidate {id:string;full_name:string;employee_code:string;skill_level:string}
export interface ChangeQueue {enabled:boolean;sources:ChangeSource[];invitations:ReplacementInvite[]}
export const shiftChangeService={
 async read():Promise<ChangeQueue>{return(await authorized('',{},'/shift-changes')).result;},
 async candidates(assignment_id:string):Promise<Candidate[]>{return(await authorized(`/candidates?assignment_id=${encodeURIComponent(assignment_id)}`,{},'/shift-changes')).result;},
 async act(action:string,data:Record<string,unknown>,request_id:string):Promise<{status?:string;composition_shortages?:unknown[]}>{return(await authorized('/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data,request_id})},'/shift-changes')).result;},
};
