import type { UserRole, UserProfile } from '../../types/auth';

export type ScheduleStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'NEEDS_REVISION' | 'APPROVED' | 'PUBLISHED';
export type ScheduleDecision = 'APPROVED' | 'NEEDS_REVISION';
export type ScheduleWorkflowView = 'pending' | 'history' | 'manager' | 'publicationHistory';

export const TV4_SHIFT_DEFINITIONS = [
  { id: 'tv4-shift-morning', name: 'Ca sáng', start_time: '08:00:00', end_time: '12:00:00' },
  { id: 'tv4-shift-afternoon', name: 'Ca chiều', start_time: '12:00:00', end_time: '17:00:00' },
  { id: 'tv4-shift-evening', name: 'Ca tối', start_time: '17:00:00', end_time: '22:00:00' },
] as const;

export interface ScheduleWorkflowActor {
  id: string;
  username: string;
  role: UserRole;
  branch_id: string | null;
}

export interface ScheduleAssignment {
  id: string;
  work_date: string;
  status: 'DRAFT' | 'ACTIVE' | 'REPLACED';
  assignment_source: string;
  employees: { full_name: string; department_id: string; departments: { name: string } };
  shifts: { id: string; name: string; start_time: string; end_time: string };
  departments: { name: string };
}

export interface ScheduleApproval {
  id: string;
  schedule_id: string;
  supervisor_id: string;
  decision: ScheduleDecision;
  reason: string | null;
  decided_at: string;
  users: { username: string };
}

export interface ScheduleWorkflowRecord {
  id: string;
  schedule_group_id: string;
  branch_id: string;
  period_id: string;
  version: number;
  status: ScheduleStatus;
  created_by: string;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  published_by_username?: string | null;
  feedback_deadline_at: string | null;
  resubmission_note?: string | null;
  branches: { id: string; name: string };
  registration_periods: { work_start_date: string; work_end_date: string };
  shift_assignments: ScheduleAssignment[];
  approvals: ScheduleApproval[];
  is_latest: boolean;
}

export interface ScheduleWorkflowService {
  listSchedules(actor: ScheduleWorkflowActor, view: ScheduleWorkflowView): Promise<ScheduleWorkflowRecord[]>;
  decideSchedule(actor: ScheduleWorkflowActor, scheduleId: string, decision: ScheduleDecision, reason?: string): Promise<ScheduleWorkflowRecord>;
  resubmitSchedule(actor: ScheduleWorkflowActor, scheduleId: string, adjustmentNote: string, assignments: ScheduleAssignment[]): Promise<ScheduleWorkflowRecord>;
  publishSchedule(actor: ScheduleWorkflowActor, scheduleId: string, feedbackDeadlineAt: string): Promise<ScheduleWorkflowRecord>;
}

export class ScheduleWorkflowError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ScheduleWorkflowError';
  }
}

const DEMO_BRANCHES = [
  { id: 'tv4-branch-central', name: 'Hải Châu', aliases: ['Chi nhánh mô phỏng Hải Châu'], demoName: 'JolliShift Demo · Hải Châu' },
  { id: 'tv4-branch-north', name: 'Thanh Khê 1', aliases: [], demoName: 'JolliShift Demo · Thanh Khê 1' },
  { id: 'tv4-branch-east', name: 'Sơn Trà', aliases: [], demoName: 'JolliShift Demo · Sơn Trà' },
  { id: '11111111-1111-1111-1111-111111111111', name: 'Jollibee Lê Duẩn', aliases: [], demoName: 'JolliShift Demo · Jollibee Lê Duẩn' },
] as const;

export interface Tv4MockBranchResolution {
  profileBranchId: string | null;
  profileBranchName: string | null;
  fixtureBranchId: string | null;
  fixtureBranchName: string | null;
  diagnostic: string;
}

function normalizeBranchName(value: string): string {
  return value
    .replace(/^jollishift demo\s*[·:-]?\s*/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi');
}

export function resolveTv4MockBranch(
  profile: Pick<UserProfile, 'branch_id' | 'branch_name'>,
): Tv4MockBranchResolution {
  const byId = DEMO_BRANCHES.find(branch => branch.id === profile.branch_id);
  const normalizedProfileName = normalizeBranchName(profile.branch_name || '');
  const byName = DEMO_BRANCHES.find(branch => [branch.name, ...branch.aliases]
    .some(name => normalizeBranchName(name) === normalizedProfileName));
  const match = byId || byName;
  const profileBranchId = profile.branch_id || null;
  const profileBranchName = profile.branch_name?.trim() || null;
  const fixtureBranchId = match?.id || null;
  const fixtureBranchName = match?.demoName || null;
  const diagnostic = match
    ? `Profile branch_name="${profileBranchName || '(trống)'}", branch_id="${profileBranchId || '(null)'}" → fixture "${fixtureBranchName}" (${fixtureBranchId}).`
    : `Không ánh xạ được chi nhánh demo. Profile branch_name="${profileBranchName || '(trống)'}", branch_id="${profileBranchId || '(null)'}". Cần fixture có tên chi nhánh khớp chính xác.`;

  return { profileBranchId, profileBranchName, fixtureBranchId, fixtureBranchName, diagnostic };
}

/** Map an authenticated user to an isolated demo identity and its matching demo branch. */
export function mockActorForProfile(profile: Pick<UserProfile, 'username' | 'role' | 'branch_id' | 'branch_name'>): ScheduleWorkflowActor {
  if (profile.role === 'GS') {
    return { id: 'tv4-demo-supervisor', username: profile.username, role: 'GS', branch_id: null };
  }
  const branchId = resolveTv4MockBranch(profile).fixtureBranchId;
  if (profile.role === 'QL') {
    const branchSuffix = branchId === 'tv4-branch-north' ? 'north'
      : branchId === 'tv4-branch-east' ? 'east'
        : branchId === 'tv4-branch-central' ? 'central'
          : branchId === '11111111-1111-1111-1111-111111111111' ? 'le-duan' : 'unmapped';
    return { id: `tv4-demo-manager-${branchSuffix}`, username: profile.username, role: 'QL', branch_id: branchId };
  }
  return { id: 'tv4-demo-employee', username: profile.username, role: 'NV', branch_id: branchId };
}
