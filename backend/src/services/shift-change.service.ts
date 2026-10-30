import { ShiftChangeError, type ShiftChangeAction, type ShiftChangeActor, type ShiftChangeRepository } from '../types/shift-change.types.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ShiftChangeError(400, 'INVALID_INPUT', 'Mã dữ liệu phải là UUID.');
}
function body(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)))
    throw new ShiftChangeError(400, 'INVALID_INPUT', 'Nội dung yêu cầu không hợp lệ hoặc chứa trường không được phép.');
  return value as Record<string, unknown>;
}
export class ShiftChangeService {
  constructor(private readonly repository: ShiftChangeRepository) {}
  async execute(action: ShiftChangeAction, actor: ShiftChangeActor, resourceId?: string, value: unknown = {}) {
    if (!actor.is_active || actor.must_change_password !== false || !['NV', 'QL'].includes(actor.role))
      throw new ShiftChangeError(403, 'FORBIDDEN', 'Không có quyền xử lý đổi ca.');
    const employeeOnly = ['candidates', 'assignments', 'invitations', 'create', 'respond'].includes(action);
    const managerOnly = ['decision', 'refresh'].includes(action);
    if ((employeeOnly && (actor.role !== 'NV' || !actor.employee?.id)) || (managerOnly && actor.role !== 'QL') || !actor.branch_id)
      throw new ShiftChangeError(403, 'FORBIDDEN', 'Vai trò hoặc phạm vi chi nhánh không phù hợp.');
    const input: Record<string, unknown> = {};
    if (['candidates', 'respond', 'decision', 'refresh'].includes(action)) { id(resourceId); input.id = resourceId; }
    if (action === 'create') {
      const data = body(value, ['original_assignment_id', 'reason', 'proposed_employee_id']);
      id(data.original_assignment_id);
      if (typeof data.reason !== 'string' || !data.reason.trim()) throw new ShiftChangeError(400, 'INVALID_INPUT', 'Cần nhập lý do đổi ca.');
      Object.assign(input, { original_assignment_id: data.original_assignment_id, reason: data.reason.trim() });
      if (data.proposed_employee_id !== undefined) { id(data.proposed_employee_id); input.proposed_employee_id = data.proposed_employee_id; }
    } else if (action === 'respond') {
      const data = body(value, ['response']);
      if (typeof data.response !== 'string' || !['ACCEPTED', 'DECLINED'].includes(data.response)) throw new ShiftChangeError(400, 'INVALID_INPUT', 'Phản hồi phải là ACCEPTED hoặc DECLINED.');
      input.response = data.response;
    } else if (action === 'decision') {
      const data = body(value, ['decision', 'replacement_employee_id', 'reason']);
      if (typeof data.decision !== 'string' || !['APPROVED', 'REJECTED'].includes(data.decision)) throw new ShiftChangeError(400, 'INVALID_INPUT', 'Quyết định phải là APPROVED hoặc REJECTED.');
      if (data.reason !== undefined && typeof data.reason !== 'string') throw new ShiftChangeError(400, 'INVALID_INPUT', 'Lý do phải là chuỗi.');
      if (data.decision === 'APPROVED') { id(data.replacement_employee_id); input.replacement_employee_id = data.replacement_employee_id; }
      else if (data.replacement_employee_id !== undefined) throw new ShiftChangeError(400, 'INVALID_INPUT', 'Từ chối không nhận người thay thế.');
      input.decision = data.decision;
      if (typeof data.reason === 'string') input.reason = data.reason.trim();
    } else { body(value, []); }
    return this.repository.execute(action, actor.id, input);
  }
}
