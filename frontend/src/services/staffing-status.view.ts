import type { RegistrationSummaryRow } from '../types/scheduling';
export function staffingStatus(row:RegistrationSummaryRow) {
  const ratio=`${row.eligible_count??'—'} / ${row.required_count??'—'}`;
  if(row.required_count===null)return {ratio,label:'Chưa thể đánh giá',tone:'unknown'};
  if(row.eligible_count===null||row.status==='UNKNOWN')return {ratio,label:'Chưa thể đánh giá',tone:'unknown'};
  if(row.required_count===0)return {ratio,label:'Không cần người',tone:'not-required'};
  if(row.status==='SHORTAGE'&&row.shortage_count!==null)return {ratio,label:`Thiếu ${row.shortage_count}`,tone:'shortage'};
  if(row.status==='SURPLUS'&&row.surplus_count!==null)return {ratio,label:`Dư ${row.surplus_count} ứng viên`,tone:'surplus'};
  if(row.status==='BALANCED')return {ratio,label:'Đủ người',tone:'balanced'};
  return {ratio,label:'Chưa thể đánh giá',tone:'unknown'};
}
export const exclusionLabel:Record<string,string>={SKILL_MISMATCH:'Không đáp ứng kỹ năng bắt buộc',DEPARTMENT_MISMATCH:'Sai bộ phận',INACTIVE_EMPLOYEE:'Nhân viên/tài khoản không hoạt động',CREW_LEADER_EXCLUDED:'Crew Leader không tính vào nhu cầu thường',CONSTRAINT_FAILED:'Không đáp ứng ràng buộc nhận ca',SHIFT_OVERLAP:'Trùng giờ với lịch hiện có',WEEKLY_LIMIT_EXCEEDED:'Vượt giờ đã cấu hình',DAILY_LIMIT_EXCEEDED:'Vượt giới hạn ca thử nghiệm',INCOMPLETE_EMPLOYEE_DATA:'Thiếu hồ sơ để đánh giá'};
