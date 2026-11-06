import { ScheduleError } from './scheduling.engine.js';
import { isTestPreviewRequested, requireNonTestScheduleWrites } from './test-preview-policy.js';
import { draftPeriodWriteScopeAllowed, type WritePeriod } from './draft-write-scope.js';

export function isDraftPersistenceEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  return !isTestPreviewRequested(env)&&env.TV3_DRAFT_PERSISTENCE_ENABLED==='true';
}

/** Explains application gates without claiming database RPC/ACL readiness. */
export function draftPersistenceAvailability(period:WritePeriod&{status:string},source:string,developmentPreview=false,env:NodeJS.ProcessEnv=process.env) {
  const blocked=(code:string,reason:string)=>({enabled:false,code,reason});
  if(source!=='supabase')return blocked('MOCK_READ_ONLY','Dữ liệu mô phỏng chỉ dùng để xem trước; không lưu DRAFT trên Supabase.');
  if(isTestPreviewRequested(env))return blocked('TEST_PREVIEW_READ_ONLY','Backend đang ở chế độ chỉ xem trước; không cho lưu DRAFT hoặc xử lý phê duyệt.');
  if(developmentPreview||period.status!=='CLOSED')return blocked('PERIOD_NOT_CLOSED','Kỳ đăng ký chưa đóng; chỉ xem trước, chưa được lưu DRAFT.');
  if(!draftPeriodWriteScopeAllowed(period,env))return blocked('DRAFT_WRITE_SCOPE_FORBIDDEN','Project, chi nhánh, kỳ hoặc khoảng ngày chưa được phép lưu DRAFT trong môi trường này.');
  if(!isDraftPersistenceEnabled(env))return blocked('DRAFT_PERSISTENCE_DISABLED','Chưa bật lưu DRAFT. Cần triển khai và xác minh migration trước.');
  return {enabled:true,code:'DRAFT_PERSISTENCE_ENABLED',reason:'Lưu thành phiên bản DRAFT; dữ liệu và quyền sẽ được kiểm tra lại trước khi ghi.'};
}

// One fail-closed gate for all TV3 schedule writers, including legacy/mock paths.
// This is an application switch, not a database ACL or a Supabase configuration.
export function requireDraftPersistenceEnabled():void {
  requireNonTestScheduleWrites();
  if(!isDraftPersistenceEnabled())throw new ScheduleError(503,'DRAFT_PERSISTENCE_DISABLED','Chưa bật lưu DRAFT. Cần triển khai và xác minh migration đã duyệt.');
}
