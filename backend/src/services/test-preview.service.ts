import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';
import { buildLDTestFixture } from './ld-test-fixture.js';
import { previewSchedule } from './schedule-preview.service.js';
import { ScheduleError } from './scheduling.engine.js';
import { LD_TEST_BRANCH_ID, LD_TEST_PERIOD_ID, requireTestPreview } from './test-preview-policy.js';

export async function previewTestSchedule(periodId:string,branchId:string,body:Record<string,unknown>,repository?:RegistrationSummaryRepository) {
  const batchId=requireTestPreview();
  if(branchId!==LD_TEST_BRANCH_ID||periodId!==LD_TEST_PERIOD_ID)throw new ScheduleError(403,'TEST_FIXTURE_SCOPE','Sai chi nhánh hoặc tuần kiểm thử.');
  if(Object.keys(body).some(k=>k!=='period_id'))throw new ScheduleError(400,'INVALID_TEST_PREVIEW','Chỉ nhận period_id; batch và test mode do backend quyết định.');
  const real=await (repository??registrationSummaryRepository()).load(branchId,periodId);
  const fixture=buildLDTestFixture(real,batchId);
  // Only the normal read/compute preview is reused. No persist/AI/workflow call.
  const readOnly:RegistrationSummaryRepository={source:'supabase',load:async()=>structuredClone(fixture.snapshot),listPeriods:async()=>[],
    saveRequirement:async()=>{throw new ScheduleError(403,'TEST_PREVIEW_READ_ONLY','Không ghi dữ liệu test.');},
    clearRequirement:async()=>{throw new ScheduleError(403,'TEST_PREVIEW_READ_ONLY','Không ghi dữ liệu test.');}};
  const preview=await previewSchedule(periodId,branchId,{period_id:periodId},readOnly);
  requireTestPreview(); // Configuration cannot change mid-flight and release an unlabelled plan.
  return {...preview,kind:'test-preview' as const,test_mode:true as const,test_metadata:fixture.metadata,
    source:'test-fixture' as const,context:{...preview.context,source:'test-fixture' as const},
    capabilities:{save_draft:false,publish:false,approval_handoff:false},
    persistence:{enabled:false as const,reason:'Fixture trong bộ nhớ, chỉ preview; không được lưu hoặc công bố.'}};
}
