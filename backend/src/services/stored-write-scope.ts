import { supabaseAdmin } from '../config/supabase.js';
import { isIsolatedWriteScope, requireDraftWriteScope, requireDraftPeriodWriteScope } from './draft-write-scope.js';
import { ScheduleError } from './scheduling.engine.js';

/** Verify persisted dates even on retry/legacy paths that do not load a preview. */
export async function requireStoredDraftWriteScope(periodId:string,branchId:string|undefined):Promise<void> {
  requireDraftWriteScope(periodId,branchId);
  if(!isIsolatedWriteScope())return;
  const {data,error}=await supabaseAdmin.from('registration_periods')
    .select('id,branch_id,work_start_date,work_end_date').eq('id',periodId).eq('branch_id',branchId!).maybeSingle();
  if(error)throw new ScheduleError(503,'DRAFT_WRITE_SCOPE_UNAVAILABLE','Chưa thể xác minh khoảng ngày của kỳ kiểm thử. Không có dữ liệu nào được ghi.');
  if(!data)throw new ScheduleError(403,'DRAFT_WRITE_SCOPE_FORBIDDEN','Không tìm thấy kỳ trong phạm vi kiểm thử được phép.');
  requireDraftPeriodWriteScope(data);
}
