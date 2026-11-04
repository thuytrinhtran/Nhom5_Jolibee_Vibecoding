import { authorized } from './auth.service';
export interface ManagerOverview {source:'supabase';employee_count:number;registered_employees:number;schedule_status:string|null;official_schedule_status:string|null;assignment_count:number|null;assignment_kind:string;pending_requests:number;shortage_cells:number|null;shortage_positions:number|null}
export async function loadManagerOverview(periodId:string):Promise<ManagerOverview>{return(await authorized(`/periods/${encodeURIComponent(periodId)}/overview`,{},'/schedules')).result;}
