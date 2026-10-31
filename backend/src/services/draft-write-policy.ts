import { ScheduleError } from './scheduling.engine.js';

export function isDraftPersistenceEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  return env.TV3_DRAFT_PERSISTENCE_ENABLED==='true';
}

// One fail-closed gate for all TV3 schedule writers, including legacy/mock paths.
// This is an application switch, not a database ACL or a Supabase configuration.
export function requireDraftPersistenceEnabled():void {
  if(!isDraftPersistenceEnabled())throw new ScheduleError(503,'DRAFT_PERSISTENCE_DISABLED','Chưa bật lưu DRAFT. Cần triển khai và xác minh migration đã duyệt.');
}
