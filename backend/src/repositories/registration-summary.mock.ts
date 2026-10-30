import { tv3FlowSnapshot } from './tv3-flow.fixture.js';
import { mockRecords } from './mock-schedule.store.js';
import { randomUUID } from 'node:crypto';
import { ScheduleError } from '../services/scheduling.engine.js';
import type { DemandInput, DemandRequirement, RegistrationSummaryRepository, SummarySnapshot } from './registration-summary.types.js';
export const MOCK_PERIOD_ID = '33333333-0000-4000-8000-000000000001';
const id = (n: number) => `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`;

const demandStore = new Map<string, SummarySnapshot['requirements']>();

// Synthetic fixtures only. No Supabase imports or database writes.
export function mockSummarySnapshot(branchId: string): SummarySnapshot {
  const departments = [{ id: id(10), name: 'Bếp' }, { id: id(11), name: 'Thu ngân' }, { id: id(12), name: 'Phục vụ' }];
  const period = { id: MOCK_PERIOD_ID, branch_id: branchId, work_start_date: '2026-11-02', work_end_date: '2026-11-08', status: 'CLOSED' };
  const shifts = [{ id: id(20), name: 'Ca 1', start_time: '08:00:00', end_time: '12:00:00', is_active: true, branch_id: branchId },
    { id: id(21), name: 'Ca 2', start_time: '12:00:00', end_time: '17:00:00', is_active: true, branch_id: branchId },
    { id: id(22), name: 'Ca 3', start_time: '17:00:00', end_time: '22:00:00', is_active: true, branch_id: branchId }];
  const employees = [
    ['An (mô phỏng)', 0, ['Bếp nóng']], ['Bình (mô phỏng)', 0, ['Bếp nóng']],
    ['Chi (mô phỏng)', 1, ['Thu ngân']], ['Dung (mô phỏng)', 2, ['Phục vụ']],
    ['Em (mô phỏng)', 2, ['Phục vụ']], ['Giang (mô phỏng)', 2, ['Phục vụ']],
    ['Hà (mô phỏng)', 0, []],
  ].map(([name, department, skills], i) => ({ id: id(100 + i), branch_id: branchId, full_name: name as string,
    department_id: departments[department as number].id, skill_level: 'REGULAR', status: 'ACTIVE',
    is_active: true, role: 'NV', max_weekly_hours: null, skills: skills as string[] }));
  let serial = 200;
  const registration = (employee: number, day: string) => ({ id: id(serial++), period_id: period.id, employee_id: employees[employee].id, work_date: day, shift_id: shifts[0].id, status: 'VALID' });
  const registrations = employees.slice(0, 6).map((_, i) => registration(i, '2026-11-02'));
  registrations.push(registration(0, '2026-11-02')); // Same employee/date/shift: count once.
  registrations.push(registration(0, '2026-11-03'), registration(6, '2026-11-03'));
  registrations.push(registration(3, '2026-11-03')); // Service employee cannot satisfy kitchen demand.
  registrations.push(registration(1, '2026-11-04')); // Missing demand, not a zero-demand row.
  const requirements = [
    [0, '2026-11-02', 2, 'Bếp nóng'], [1, '2026-11-02', 2, 'Thu ngân'], [2, '2026-11-02', 1, 'Phục vụ'],
    [0, '2026-11-03', 2, 'Bếp nóng'], [2, '2026-11-03', 1, 'Phục vụ'],
  ].map(([department, day, count, skill], i) => ({ id: id(300 + i), department_id: departments[department as number].id,
    shift_id: shifts[0].id, work_date: day as string, required_count: count as number, required_skill_name: skill as string, sales_forecast_ref: i === 0 ? 'Nguồn Sales Forecast mô phỏng' : null, updated_at: '2026-10-29T00:00:00.000Z', created_by: id(999) }));
  return { source: 'mock', branch: { id: branchId, name: 'Chi nhánh mô phỏng TV3' }, period,
    departments, shifts, employees, registrations, requirements, existing: [], new_employee_count_threshold: null };
}
export class MockRegistrationSummaryRepository implements RegistrationSummaryRepository {
  readonly source = 'mock' as const;
  constructor(readonly scenario: 'summary'|'tv3-flow' = 'summary') {}
  async listPeriods(branchId: string) { return [{ ...mockSummarySnapshot(branchId).period, schedules: mockRecords(branchId,MOCK_PERIOD_ID,this.scenario).map(r=>r.schedule) }]; }
  snapshot(branchId: string, periodId: string) {
    if (periodId !== MOCK_PERIOD_ID) throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt mô phỏng.');
    const snapshot = this.scenario==='tv3-flow'?tv3FlowSnapshot(branchId):mockSummarySnapshot(branchId);
    snapshot.requirements = structuredClone(demandStore.get(`${this.scenario}/${branchId}/${periodId}`) ?? snapshot.requirements);
    return snapshot;
  }
  async load(branchId:string,periodId:string) { return this.snapshot(branchId,periodId); }
  async clearRequirement(branchId:string,periodId:string,id:string,expected:string) {
    const snapshot=await this.load(branchId,periodId);
    const key=`${this.scenario}/${branchId}/${periodId}`;
    const rows=demandStore.get(key)??snapshot.requirements;
    if (!rows.some(r=>r.id===id&&r.updated_at===expected)) throw new ScheduleError(409,'DEMAND_CHANGED','Nhu cầu đã thay đổi. Vui lòng tải lại tuần.');
    demandStore.set(key,structuredClone(rows.filter(r=>r.id!==id)));
  }
  async saveRequirement(branchId: string, periodId: string, actorId: string, input: DemandInput, existingId: string | null): Promise<DemandRequirement> {
    const snapshot = await this.load(branchId, periodId);
    // Read the latest in-memory state after await so concurrent editors use the same revision.
    const key = `${this.scenario}/${branchId}/${periodId}`;
    const rows = structuredClone(demandStore.get(key) ?? snapshot.requirements);
    const current = rows.find(r => r.work_date === input.work_date && r.shift_id === input.shift_id && r.department_id === input.department_id);
    if ((current?.id ?? null) !== existingId || (current?.updated_at ?? null) !== input.expected_updated_at)
      throw new ScheduleError(409, 'DEMAND_CHANGED', 'Nhu cầu đã được người khác thay đổi. Vui lòng tải lại tuần.');
    const { expected_updated_at, ...fields } = input;
    const saved: DemandRequirement = { ...fields, id: current?.id ?? randomUUID(), created_by: current?.created_by ?? actorId,
      updated_at: new Date(Math.max(Date.now(), expected_updated_at ? Date.parse(expected_updated_at) + 1 : 0)).toISOString() };
    demandStore.set(key, [...rows.filter(r => r.id !== current?.id), saved]);
    return structuredClone(saved);
  }

}
