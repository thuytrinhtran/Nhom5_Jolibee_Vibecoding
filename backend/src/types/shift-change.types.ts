import type { AuthenticatedUser } from './auth.types.js';

export type ShiftChangeAction = 'candidates' | 'assignments' | 'requests' | 'invitations' | 'create' | 'respond' | 'decision' | 'refresh';
export interface ShiftChangeCandidate { employee_id: string; full_name: string }
export interface ShiftChangeCandidatesResult {
  assignment_id: string;
  request_deadline_at: string;
  candidates: ShiftChangeCandidate[];
}
export type ShiftChangeStatus = 'PENDING' | 'SEARCHING' | 'APPROVED' | 'REJECTED';
export type InvitationResponse = 'ACCEPTED' | 'DECLINED';
export interface CreateShiftChange {
  original_assignment_id: string;
  reason: string;
  proposed_employee_id?: string;
}
export interface ShiftChangeDecision {
  decision: 'APPROVED' | 'REJECTED';
  replacement_employee_id?: string;
  reason?: string;
}
export interface ShiftChangeResult {
  [key: string]: unknown;
}
export interface ShiftChangeRepository {
  execute(action: ShiftChangeAction, actorId: string, input: Record<string, unknown>): Promise<ShiftChangeResult>;
}
export type ShiftChangeActor = Pick<AuthenticatedUser, 'id' | 'role' | 'branch_id' | 'is_active' | 'must_change_password' | 'employee'>;
export class ShiftChangeError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
