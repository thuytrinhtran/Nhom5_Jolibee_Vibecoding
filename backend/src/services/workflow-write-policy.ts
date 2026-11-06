import { draftWriteScopeAllowed, isTestWriteScope } from './draft-write-scope.js';

export const workflowEnabled = () => process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED === 'true' && process.env.TV3_TEST_PREVIEW_ENABLED !== 'true';

// Read-only explanation of the same gates enforced before the workflow RPC.
export function workflowWriteAvailability(periodId:string, branchId:string, source:string) {
  let code:string|null=null, message='Chưa gửi lịch. Xác nhận gửi để lưu trạng thái chờ Giám sát phê duyệt.';
  if(process.env.TV3_TEST_PREVIEW_ENABLED==='true') {
    code='TEST_PREVIEW_READ_ONLY'; message='Backend preview kiểm thử không cho ghi nhu cầu, lưu, gửi duyệt hoặc công bố lịch.';
  } else if(isTestWriteScope() && process.env.TV3_WRITE_SCOPE_ENABLED!=='true') {
    code='WORKFLOW_SCOPE_FORBIDDEN'; message='Chế độ nghiệm thu yêu cầu TV3_WRITE_SCOPE_ENABLED=true và giới hạn ghi đúng kỳ test.';
  } else if(!workflowEnabled()) {
    code='WORKFLOW_PERSISTENCE_DISABLED'; message='Backend chưa cho phép ghi workflow: TV4_WORKFLOW_PERSISTENCE_ENABLED chưa bằng true. Quản trị cần nghiệm thu migration/RPC trước khi bật; lịch chưa được gửi.';
  } else if(source!=='supabase') {
    code='MOCK_READ_ONLY'; message='Nguồn lịch không phải Supabase; không thể gửi lịch thật bằng dữ liệu giả lập.';
  } else if(!draftWriteScopeAllowed(periodId,branchId)) {
    code='WORKFLOW_SCOPE_FORBIDDEN'; message='Lịch nằm ngoài phạm vi ghi đã cấu hình (project, môi trường, chi nhánh hoặc kỳ đăng ký). Backend không được phép gửi lịch này.';
  }
  return {configured:code===null,code,message};
}
