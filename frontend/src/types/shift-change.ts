export type RequestStatus = 'PENDING' | 'SEARCHING' | 'APPROVED' | 'REJECTED';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
export interface ShiftInfo { name: string; start_time: string; end_time: string }
export interface Assignment {
  id: string; schedule_id: string; employee_id: string; work_date: string;
  shift_id: string; department_id: string; actual_branch_id: string; status: string;
}
export interface AvailableAssignment extends Assignment { shift: ShiftInfo; request_deadline_at: string }
export interface RequestInvitation {
  id: string; target_employee_id: string; full_name: string; status: InvitationStatus;
  effective_status: InvitationStatus; expires_at: string; responded_at: string | null; eligible_now: boolean;
}
export interface ShiftChangeRequest {
  id: string; original_assignment_id: string; requesting_employee_id: string; reason: string;
  status: RequestStatus; created_at: string; approved_by: string | null; resolved_at: string | null;
  replacement_employee_id: string | null; replacement_assignment_id: string | null;
  original_assignment: Assignment; schedule_state: string; shift: ShiftInfo;
  requesting_employee_name: string; warning: 'NO_AVAILABLE_REPLACEMENT' | null;
  invitations: RequestInvitation[];
}
export interface EmployeeInvitation {
  id: string; shift_change_request_id: string; target_employee_id: string;
  status: InvitationStatus; effective_status: InvitationStatus; expires_at: string;
  sent_at: string; responded_at: string | null; valid_when_confirmed: boolean | null;
  assignment: Assignment; shift_name: string; start_time: string; end_time: string;
}
export interface Candidate { employee_id: string; full_name: string }
export interface CandidatesResult { assignment_id: string; request_deadline_at: string; candidates: Candidate[] }
export interface AssignmentsResult { assignments: AvailableAssignment[]; schedule_issues: { schedule_id: string; code: string }[] }
export interface SearchResult {
  request_id: string; invitations_created: number; accepted_count: number; pending_count: number;
  warning: 'NO_AVAILABLE_REPLACEMENT' | null;
}
export interface ResponseResult extends SearchResult { response_recorded: boolean; expired?: boolean }
export interface DecisionResult { request_id: string; new_assignment_id: string | null; decision: 'APPROVED' | 'REJECTED' }
