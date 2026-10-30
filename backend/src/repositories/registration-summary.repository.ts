import { supabaseAdmin } from '../config/supabase.js';
import { ScheduleError } from '../services/scheduling.engine.js';
import { MockRegistrationSummaryRepository } from './registration-summary.mock.js';
import { SupabaseRegistrationSummaryRepository } from './registration-summary.supabase.js';
import type { RegistrationSummaryRepository } from './registration-summary.types.js';

export function registrationSummaryRepository(env = process.env): RegistrationSummaryRepository {
  const source = env.SCHEDULING_DATA_SOURCE || 'supabase';
  if (source === 'supabase') return new SupabaseRegistrationSummaryRepository(supabaseAdmin);
  if (source === 'mock' && env.NODE_ENV === 'development') {
    const scenario=env.SCHEDULING_MOCK_SCENARIO||'summary';
    if(!['summary','tv3-flow'].includes(scenario))throw new ScheduleError(503,'INVALID_MOCK_SCENARIO','Kịch bản dữ liệu thử nghiệm không hợp lệ.');
    return new MockRegistrationSummaryRepository(scenario as 'summary'|'tv3-flow');
  }
  throw new ScheduleError(503, 'INVALID_SUMMARY_MODE', 'Nguồn dữ liệu tổng hợp không hợp lệ. Mock chỉ được bật rõ ràng trong development.');
}
export function requireRealSchedulingData() {
  if (registrationSummaryRepository().source === 'mock') throw new ScheduleError(409, 'MOCK_READ_ONLY', 'Mock Mode không cho đọc hoặc ghi lịch trên Supabase chung; lịch thử nghiệm dùng kho bộ nhớ riêng.');
}
