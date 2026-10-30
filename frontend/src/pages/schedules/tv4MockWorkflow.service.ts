import type {
  ScheduleApproval, ScheduleAssignment, ScheduleDecision, ScheduleWorkflowActor,
  ScheduleWorkflowRecord, ScheduleWorkflowService, ScheduleWorkflowView,
} from './scheduleWorkflow.types';
import { ScheduleWorkflowError, TV4_SHIFT_DEFINITIONS } from './scheduleWorkflow.types';

type Branch = { id: string; name: string; supervisor_id: string };
type MockStore = { branches: Branch[]; schedules: ScheduleWorkflowRecord[]; sequence: number };
type Clock = () => Date;

const CENTRAL = 'tv4-branch-central';
const NORTH = 'tv4-branch-north';
const EAST = 'tv4-branch-east';
const LE_DUAN = '11111111-1111-1111-1111-111111111111';
const SUPERVISOR = 'tv4-demo-supervisor';

function demoManagerId(branchId: string): string {
  const suffix = branchId === CENTRAL ? 'central'
    : branchId === NORTH ? 'north'
      : branchId === LE_DUAN ? 'le-duan' : 'east';
  return `tv4-demo-manager-${suffix}`;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function assignments(suffix: string): ScheduleAssignment[] {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(Date.UTC(2026, 10, 2 + offset));
    return day.toISOString().slice(0, 10);
  });
  return days.flatMap(workDate => TV4_SHIFT_DEFINITIONS.map((shift, shiftIndex) => {
    // The fixture contains two existing demo employees; Minh Anh covers the non-overlapping morning/evening shifts.
    const employee = shiftIndex === 1
      ? { full_name: 'Trần Quốc Bảo', department_id: 'kitchen', departments: { name: 'Bếp' } }
      : { full_name: 'Nguyễn Minh Anh', department_id: 'front', departments: { name: 'Phục vụ' } };
    return {
      id: `${suffix}-${workDate}-${shift.id}`,
      work_date: workDate,
      status: 'DRAFT' as const,
      assignment_source: 'REGULAR',
      employees: employee,
      shifts: { id: shift.id, name: shift.name, start_time: shift.start_time, end_time: shift.end_time },
      departments: { name: employee.departments.name },
    } as ScheduleAssignment;
  }));
}

function datesInPeriod(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const dates: string[] = [];
  for (let current = start; current <= end; current += 24 * 60 * 60 * 1000) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

function makeSchedule(args: {
  id: string; group: string; branch: Branch; version: number; status: ScheduleWorkflowRecord['status'];
  createdAt: string; assignments?: ScheduleAssignment[]; approvals?: ScheduleApproval[];
}): ScheduleWorkflowRecord {
  return {
    id: args.id,
    schedule_group_id: args.group,
    branch_id: args.branch.id,
    period_id: `period-${args.group}`,
    version: args.version,
    status: args.status,
    created_by: demoManagerId(args.branch.id),
    created_at: args.createdAt,
    published_at: null,
    published_by: null,
    published_by_username: null,
    feedback_deadline_at: null,
    branches: { id: args.branch.id, name: args.branch.name },
    registration_periods: { work_start_date: '2026-11-02', work_end_date: '2026-11-08' },
    shift_assignments: clone(args.assignments || assignments(args.id)),
    approvals: clone(args.approvals || []),
    is_latest: true,
  };
}

export function createTv4MockSeed(): MockStore {
  const central: Branch = { id: CENTRAL, name: 'JolliShift Demo · Hải Châu', supervisor_id: SUPERVISOR };
  const north: Branch = { id: NORTH, name: 'JolliShift Demo · Thanh Khê 1', supervisor_id: SUPERVISOR };
  const east: Branch = { id: EAST, name: 'JolliShift Demo · Sơn Trà', supervisor_id: 'tv4-demo-supervisor-east' };
  const leDuan: Branch = { id: LE_DUAN, name: 'JolliShift Demo · Jollibee Lê Duẩn', supervisor_id: SUPERVISOR };
  const rejectedAt = '2026-10-28T09:15:00.000Z';
  const oldDecision: ScheduleApproval = {
    id: 'tv4-seed-revision-decision-01', schedule_id: 'tv4-seed-needs-revision-01', supervisor_id: SUPERVISOR,
    decision: 'NEEDS_REVISION', reason: 'Thiếu nhân sự ở ca tối; vui lòng cân đối lại phân công.',
    decided_at: rejectedAt, users: { username: 'Giám sát Demo' },
  };
  const publishedDecision: ScheduleApproval = {
    id: 'tv4-seed-published-decision-01', schedule_id: 'tv4-seed-published-01', supervisor_id: SUPERVISOR,
    decision: 'APPROVED', reason: null, decided_at: '2026-10-27T10:00:00.000Z',
    users: { username: 'Giám sát Demo' },
  };
  const publishedSchedule = makeSchedule({
    id: 'tv4-seed-published-01', group: 'tv4-seed-published-group', branch: central, version: 1,
    status: 'PUBLISHED', createdAt: '2026-10-27T07:00:00.000Z', approvals: [publishedDecision],
  });
  publishedSchedule.published_at = '2026-10-28T11:00:00.000Z';
  publishedSchedule.published_by = 'tv4-demo-manager-central';
  publishedSchedule.published_by_username = 'Quản lý Demo';
  publishedSchedule.feedback_deadline_at = '2026-11-01T12:00:00.000Z';
  publishedSchedule.shift_assignments.forEach(assignment => { assignment.status = 'ACTIVE'; });

  const leDuanRevision: ScheduleApproval = {
    id: 'tv4-seed-le-duan-revision-decision-01', schedule_id: 'tv4-seed-le-duan-revision-01',
    supervisor_id: SUPERVISOR, decision: 'NEEDS_REVISION',
    reason: 'Cần cân đối lại nhân sự trong ca tối tại Lê Duẩn.',
    decided_at: '2026-10-28T09:30:00.000Z', users: { username: 'Giám sát Demo' },
  };
  const leDuanApproved: ScheduleApproval = {
    id: 'tv4-seed-le-duan-approved-decision-01', schedule_id: 'tv4-seed-le-duan-approved-01',
    supervisor_id: SUPERVISOR, decision: 'APPROVED', reason: null,
    decided_at: '2026-10-28T10:30:00.000Z', users: { username: 'Giám sát Demo' },
  };
  const leDuanPublishedDecision: ScheduleApproval = {
    id: 'tv4-seed-le-duan-published-decision-01', schedule_id: 'tv4-seed-le-duan-published-01',
    supervisor_id: SUPERVISOR, decision: 'APPROVED', reason: null,
    decided_at: '2026-10-27T10:30:00.000Z', users: { username: 'Giám sát Demo' },
  };
  const leDuanPublished = makeSchedule({
    id: 'tv4-seed-le-duan-published-01', group: 'tv4-seed-le-duan-published-group', branch: leDuan,
    version: 1, status: 'PUBLISHED', createdAt: '2026-10-27T08:00:00.000Z', approvals: [leDuanPublishedDecision],
  });
  leDuanPublished.published_at = '2026-10-28T11:30:00.000Z';
  leDuanPublished.published_by = demoManagerId(LE_DUAN);
  leDuanPublished.published_by_username = 'Quản lý Lê Duẩn Demo';
  leDuanPublished.feedback_deadline_at = '2026-11-01T12:00:00.000Z';
  leDuanPublished.shift_assignments.forEach(assignment => { assignment.status = 'ACTIVE'; });

  return {
    branches: [central, north, east, leDuan],
    sequence: 1,
    schedules: [
      makeSchedule({ id: 'tv4-seed-pending-group-v1', group: 'tv4-seed-pending-group', branch: central, version: 1, status: 'PENDING_APPROVAL', createdAt: '2026-10-27T08:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-pending-group-v2', group: 'tv4-seed-pending-group', branch: central, version: 2, status: 'PENDING_APPROVAL', createdAt: '2026-10-28T08:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-needs-revision-01', group: 'tv4-seed-revision-group', branch: central, version: 1, status: 'NEEDS_REVISION', createdAt: '2026-10-27T07:00:00.000Z', approvals: [oldDecision] }),
      makeSchedule({ id: 'tv4-seed-approved-01', group: 'tv4-seed-approved-group', branch: central, version: 1, status: 'APPROVED', createdAt: '2026-10-28T07:00:00.000Z', approvals: [{
        id: 'tv4-seed-approved-decision-01', schedule_id: 'tv4-seed-approved-01', supervisor_id: SUPERVISOR,
        decision: 'APPROVED', reason: null, decided_at: '2026-10-28T10:00:00.000Z', users: { username: 'Giám sát Demo' },
      }] }),
      makeSchedule({ id: 'tv4-seed-approved-stale-01', group: 'tv4-seed-current-group', branch: central, version: 1, status: 'APPROVED', createdAt: '2026-10-26T07:00:00.000Z', approvals: [{
        id: 'tv4-seed-stale-decision-01', schedule_id: 'tv4-seed-approved-stale-01', supervisor_id: SUPERVISOR,
        decision: 'APPROVED', reason: null, decided_at: '2026-10-26T10:00:00.000Z', users: { username: 'Giám sát Demo' },
      }] }),
      makeSchedule({ id: 'tv4-seed-current-group-v2', group: 'tv4-seed-current-group', branch: central, version: 2, status: 'PENDING_APPROVAL', createdAt: '2026-10-28T11:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-out-of-scope-pending', group: 'tv4-seed-east-group', branch: east, version: 1, status: 'PENDING_APPROVAL', createdAt: '2026-10-28T12:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-north-pending', group: 'tv4-seed-north-group', branch: north, version: 1, status: 'PENDING_APPROVAL', createdAt: '2026-10-28T13:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-draft-01', group: 'tv4-seed-draft-group', branch: central, version: 1, status: 'DRAFT', createdAt: '2026-10-28T14:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-draft-north', group: 'tv4-seed-draft-north-group', branch: north, version: 1, status: 'DRAFT', createdAt: '2026-10-28T14:30:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-draft-east', group: 'tv4-seed-draft-east-group', branch: east, version: 1, status: 'DRAFT', createdAt: '2026-10-28T14:45:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-le-duan-draft-01', group: 'tv4-seed-le-duan-draft-group', branch: leDuan, version: 1, status: 'DRAFT', createdAt: '2026-10-28T15:00:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-le-duan-pending-01', group: 'tv4-seed-le-duan-pending-group', branch: leDuan, version: 1, status: 'PENDING_APPROVAL', createdAt: '2026-10-28T15:15:00.000Z' }),
      makeSchedule({ id: 'tv4-seed-le-duan-revision-01', group: 'tv4-seed-le-duan-revision-group', branch: leDuan, version: 1, status: 'NEEDS_REVISION', createdAt: '2026-10-28T15:30:00.000Z', approvals: [leDuanRevision] }),
      makeSchedule({ id: 'tv4-seed-le-duan-approved-01', group: 'tv4-seed-le-duan-approved-group', branch: leDuan, version: 1, status: 'APPROVED', createdAt: '2026-10-28T15:45:00.000Z', approvals: [leDuanApproved] }),
      leDuanPublished,
      publishedSchedule,
    ],
  };
}

export class Tv4MockWorkflowService implements ScheduleWorkflowService {
  private store: MockStore;

  constructor(private readonly clock: Clock = () => new Date(), seed: MockStore = createTv4MockSeed()) {
    this.store = clone(seed);
  }

  private fail(message: string, code: string): never {
    throw new ScheduleWorkflowError(message, code);
  }

  private branchFor(schedule: ScheduleWorkflowRecord): Branch {
    const branch = this.store.branches.find(item => item.id === schedule.branch_id);
    if (!branch) return this.fail('Không tìm thấy chi nhánh của lịch.', 'BRANCH_NOT_FOUND');
    return branch;
  }

  private assertRole(actor: ScheduleWorkflowActor, role: 'GS' | 'QL'): void {
    if (actor.role !== role) this.fail('Vai trò hiện tại không được phép thực hiện thao tác này.', 'FORBIDDEN');
  }

  private assertScope(actor: ScheduleWorkflowActor, schedule: ScheduleWorkflowRecord): void {
    const branch = this.branchFor(schedule);
    const allowed = actor.role === 'GS'
      ? branch.supervisor_id === actor.id
      : actor.role === 'QL' && actor.branch_id === branch.id;
    if (!allowed) this.fail('Lịch nằm ngoài phạm vi chi nhánh được phân công.', 'OUT_OF_SCOPE');
  }

  private latestVersion(scheduleGroupId: string): number {
    const versions = this.store.schedules
      .filter(row => row.schedule_group_id === scheduleGroupId)
      .map(row => row.version);
    return versions.length ? Math.max(...versions) : 0;
  }

  private assertLatest(schedule: ScheduleWorkflowRecord): void {
    if (schedule.version !== this.latestVersion(schedule.schedule_group_id)) {
      this.fail('L?ch ?? c? phi?n b?n m?i h?n; h?y t?i l?i.', 'STALE_VERSION');
    }
  }

  private decorate(schedule: ScheduleWorkflowRecord): ScheduleWorkflowRecord {
    return { ...clone(schedule), is_latest: schedule.version === this.latestVersion(schedule.schedule_group_id) };
  }

  async listSchedules(actor: ScheduleWorkflowActor, view: ScheduleWorkflowView): Promise<ScheduleWorkflowRecord[]> {
    if (view === 'pending' || view === 'history') this.assertRole(actor, 'GS');
    else this.assertRole(actor, 'QL');
    const allowedStatuses: string[] = view === 'pending'
      ? ['PENDING_APPROVAL']
      : view === 'history'
        ? ['APPROVED', 'NEEDS_REVISION', 'PUBLISHED']
        : view === 'publicationHistory'
          ? ['PUBLISHED']
          : ['DRAFT', 'NEEDS_REVISION', 'APPROVED', 'PUBLISHED'];
    return this.store.schedules
      .filter(schedule => allowedStatuses.includes(schedule.status) && this.isInScope(actor, schedule))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(schedule => this.decorate(schedule));
  }

  private isInScope(actor: ScheduleWorkflowActor, schedule: ScheduleWorkflowRecord): boolean {
    const branch = this.store.branches.find(item => item.id === schedule.branch_id);
    if (!branch) return false;
    if (actor.role === 'GS') return branch.supervisor_id === actor.id;
    if (actor.role === 'QL') return actor.branch_id === branch.id;
    return false;
  }

  async decideSchedule(actor: ScheduleWorkflowActor, scheduleId: string, decision: ScheduleDecision, reason = ''): Promise<ScheduleWorkflowRecord> {
    this.assertRole(actor, 'GS');
    const schedule = this.store.schedules.find(item => item.id === scheduleId);
    if (!schedule) return this.fail('Không tìm thấy lịch.', 'NOT_FOUND');
    this.assertScope(actor, schedule);
    this.assertLatest(schedule);
    if (schedule.status !== 'PENDING_APPROVAL') this.fail('Chỉ lịch đang chờ duyệt mới được xử lý.', 'INVALID_STATUS');
    if (decision !== 'APPROVED' && decision !== 'NEEDS_REVISION') this.fail('Quyết định không hợp lệ.', 'INVALID_DECISION');
    const normalizedReason = reason.trim();
    if (decision === 'NEEDS_REVISION' && !normalizedReason) this.fail('Vui lòng nhập lý do từ chối.', 'REASON_REQUIRED');

    const now = this.clock().toISOString();
    schedule.approvals.unshift({
      id: `mock-approval-${this.store.sequence++}`,
      schedule_id: schedule.id,
      supervisor_id: actor.id,
      decision,
      reason: decision === 'NEEDS_REVISION' ? normalizedReason : null,
      decided_at: now,
      users: { username: actor.username },
    });
    schedule.status = decision;
    return this.decorate(schedule);
  }

  async resubmitSchedule(
    actor: ScheduleWorkflowActor,
    scheduleId: string,
    adjustmentNote: string,
    updatedAssignments: ScheduleAssignment[],
  ): Promise<ScheduleWorkflowRecord> {
    this.assertRole(actor, 'QL');
    const prior = this.store.schedules.find(item => item.id === scheduleId);
    if (!prior) return this.fail('Không tìm thấy lịch.', 'NOT_FOUND');
    this.assertScope(actor, prior);
    this.assertLatest(prior);
    if (prior.status !== 'NEEDS_REVISION') this.fail('Chỉ lịch cần điều chỉnh mới được trình lại.', 'INVALID_STATUS');
    const normalizedNote = adjustmentNote.trim();
    if (!normalizedNote) this.fail('Hãy mô tả nội dung điều chỉnh trước khi trình lại.', 'ADJUSTMENT_REQUIRED');
    if (!Array.isArray(updatedAssignments) || updatedAssignments.length !== prior.shift_assignments.length) {
      this.fail('Danh sách phân công điều chỉnh không hợp lệ.', 'INVALID_ASSIGNMENTS');
    }
    const changedAssignments = prior.shift_assignments.map(original => {
      const submitted = updatedAssignments.find(item => item.id === original.id);
      if (!submitted?.shifts?.id || !submitted.shifts.name || !submitted.shifts.start_time || !submitted.shifts.end_time) {
        this.fail('Mỗi phân công cần có một ca hợp lệ.', 'INVALID_ASSIGNMENTS');
      }
      const configuredShift = TV4_SHIFT_DEFINITIONS.find(shift =>
        shift.id === submitted.shifts.id && shift.name === submitted.shifts.name
        && shift.start_time === submitted.shifts.start_time && shift.end_time === submitted.shifts.end_time);
      if (!configuredShift) this.fail('Ca làm việc không khớp cấu hình TV4.', 'INVALID_ASSIGNMENTS');
      return { original, shift: { ...configuredShift } };
    });
    if (!changedAssignments.some(item => item.original.shifts.id !== item.shift.id)) {
      this.fail('Hãy điều chỉnh ít nhất một ca trước khi trình lại.', 'NO_ASSIGNMENT_CHANGES');
    }
    const assignmentsByDate = new Map<string, Set<string>>();
    for (const { original, shift } of changedAssignments) {
      const shiftsForDate = assignmentsByDate.get(original.work_date) || new Set<string>();
      if (shiftsForDate.has(shift.id)) this.fail('Mỗi ngày phải có đủ ba ca, không được trùng ca.', 'INVALID_ASSIGNMENTS');
      shiftsForDate.add(shift.id);
      assignmentsByDate.set(original.work_date, shiftsForDate);
    }
    const expectedDates = datesInPeriod(prior.registration_periods.work_start_date, prior.registration_periods.work_end_date);
    if (!expectedDates.length || assignmentsByDate.size !== expectedDates.length
      || expectedDates.some(date => {
        const shiftsForDate = assignmentsByDate.get(date);
        return !shiftsForDate || TV4_SHIFT_DEFINITIONS.some(shift => !shiftsForDate.has(shift.id));
      })) {
      this.fail('Mỗi ngày trong kỳ phải có đúng ba ca theo cấu hình TV4.', 'INVALID_ASSIGNMENTS');
    }
    const version = this.latestVersion(prior.schedule_group_id) + 1;
    const next = makeSchedule({
      id: `tv4-resubmitted-${prior.schedule_group_id}-v${version}`,
      group: prior.schedule_group_id,
      branch: this.branchFor(prior),
      version,
      status: 'PENDING_APPROVAL',
      createdAt: this.clock().toISOString(),
      assignments: changedAssignments.map(({ original, shift }) => ({
        ...clone(original), id: `${original.id}-v${version}`, status: 'DRAFT', shifts: clone(shift),
      })),
    });
    next.created_by = actor.id;
    next.resubmission_note = normalizedNote;
    this.store.schedules.push(next);
    return this.decorate(next);
  }

  async publishSchedule(actor: ScheduleWorkflowActor, scheduleId: string, feedbackDeadlineAt: string): Promise<ScheduleWorkflowRecord> {
    this.assertRole(actor, 'QL');
    const schedule = this.store.schedules.find(item => item.id === scheduleId);
    if (!schedule) return this.fail('Không tìm thấy lịch.', 'NOT_FOUND');
    this.assertScope(actor, schedule);
    this.assertLatest(schedule);
    if (schedule.status !== 'APPROVED') this.fail('Chỉ lịch đã được phê duyệt mới được công bố.', 'INVALID_STATUS');
    const deadline = Date.parse(feedbackDeadlineAt);
    if (!Number.isFinite(deadline) || deadline < this.clock().getTime()) {
      this.fail('Thời hạn phản hồi phải hợp lệ và không nằm trong quá khứ.', 'INVALID_DEADLINE');
    }

    const publishedAt = this.clock().toISOString();
    schedule.status = 'PUBLISHED';
    schedule.published_at = publishedAt;
    schedule.published_by = actor.id;
    schedule.published_by_username = actor.username;
    schedule.feedback_deadline_at = new Date(deadline).toISOString();
    schedule.shift_assignments.forEach(assignment => {
      if (assignment.status === 'DRAFT') assignment.status = 'ACTIVE';
    });
    return this.decorate(schedule);
  }
}

/** One in-memory store shared across TV4 screens in this browser session; reload resets the fixtures. */
export const tv4MockWorkflowService = new Tv4MockWorkflowService();
