import type { SchedulingInput, buildScheduleResult } from '../services/scheduling.engine.js';
export type MockScenario='summary'|'tv3-flow';
export interface MockScheduleRecord {
  scenario:MockScenario;
  schedule:{id:string;schedule_group_id:string;period_id:string;branch_id:string;version:number;status:'DRAFT';created_by:string;created_at:string};
  result:ReturnType<typeof buildScheduleResult>;input:SchedulingInput;fingerprint:string;note:string|null;
}
const records=new Map<string,MockScheduleRecord>();
export function mockRecords(branchId:string,periodId:string|undefined,scenario:MockScenario) {
  return [...records.values()].filter(r=>r.scenario===scenario&&r.schedule.branch_id===branchId&&(!periodId||r.schedule.period_id===periodId))
    .sort((a,b)=>b.schedule.version-a.schedule.version).map(record=>structuredClone(record));
}
export function mockRecord(id:string,branchId:string,scenario:MockScenario) {const record=records.get(id);return record?.scenario===scenario&&record.schedule.branch_id===branchId?structuredClone(record):null;}
export function storeMockRecord(record:MockScheduleRecord) {records.set(record.schedule.id,structuredClone(record));}
