import { supabaseAdmin } from '../config/supabase.js';
import { ShiftChangeError, type ShiftChangeAction, type ShiftChangeRepository, type ShiftChangeResult } from '../types/shift-change.types.js';

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
const errors: Record<string, [number, string]> = {
  FORBIDDEN: [403, 'Bạn không có quyền thực hiện thao tác này.'],
  NOT_FOUND: [404, 'Không tìm thấy dữ liệu trong phạm vi được phép.'],
  INVALID_INPUT: [400, 'Dữ liệu yêu cầu không hợp lệ.'],
  INVALID_ASSIGNMENT: [409, 'Phân công hoặc phiên bản lịch không còn hợp lệ.'],
  AMBIGUOUS_PUBLISHED_SCHEDULE: [409, 'Có nhiều nhóm lịch đã công bố cho cùng chi nhánh/tuần; chưa xác định được lịch chính thức.'],
  STALE_PUBLISHED_SCHEDULE: [409, 'Đã có phiên bản lịch được công bố mới hơn cho tuần này.'],
  DEADLINE_PASSED: [409, 'Đã hết thời hạn gửi yêu cầu hoặc ca đã bắt đầu.'],
  DUPLICATE_REQUEST: [409, 'Phân công đã có yêu cầu chưa xử lý.'],
  ALREADY_CHANGED: [409, 'Ca đã được đổi thành công, không được tiếp tục đổi lần thứ hai.'],
  INVALID_STATE: [409, 'Yêu cầu hoặc lời mời đã được xử lý.'],
  INELIGIBLE_REPLACEMENT: [409, 'Người thay thế không còn đủ điều kiện hoặc bị trùng lịch.'],
  ACCEPTANCE_REQUIRED: [409, 'Cần lời mời đã được đồng ý và còn hiệu lực.'],
};
export class SupabaseShiftChangeRepository implements ShiftChangeRepository {
  constructor(private readonly db: RpcClient = supabaseAdmin) {}
  async execute(action: ShiftChangeAction, actorId: string, input: Record<string, unknown>): Promise<ShiftChangeResult> {
    let result;
    try {
      result = action === 'candidates'
        ? await this.db.rpc('tv5_shift_change_candidates', { p_actor_id: actorId, p_assignment_id: input.id })
        : await this.db.rpc('tv5_shift_change', { p_action: action, p_actor_id: actorId, p_input: input });
    }
    catch { throw new ShiftChangeError(503, 'SHIFT_CHANGE_UNAVAILABLE', 'Không thể kết nối kho dữ liệu đổi ca.'); }
    if (result.error) {
      const code = result.error.message?.match(/^TV5:([A-Z_]+)$/)?.[1];
      if (code && errors[code]) throw new ShiftChangeError(errors[code][0], code, errors[code][1]);
      if (['23505', '40001', '40P01', '55P03'].includes(result.error.code || ''))
        throw new ShiftChangeError(409, 'CONCURRENT_CHANGE', 'Dữ liệu vừa thay đổi. Hãy tải lại trước khi thử tiếp.');
      throw new ShiftChangeError(503, 'SHIFT_CHANGE_UNAVAILABLE', 'Module đổi ca chưa sẵn sàng hoặc không thể xác nhận kết quả. Hãy tải lại dữ liệu.');
    }
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))
      throw new ShiftChangeError(503, 'INVALID_DATABASE_RESPONSE', 'Phản hồi kho dữ liệu đổi ca không hợp lệ.');
    return result.data as ShiftChangeResult;
  }
}
