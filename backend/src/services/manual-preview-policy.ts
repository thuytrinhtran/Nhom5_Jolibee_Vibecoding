import { draftWriteScopeAllowed } from './draft-write-scope.js';
import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
// Preview only: never changes the stored period or the persistence/approval policy.
export function openRegistrationPreviewAllowed(snapshot:Pick<SummarySnapshot,'source'|'period'>,env:NodeJS.ProcessEnv=process.env):boolean {
 return env.NODE_ENV==='development'&&env.TV3_OPEN_REGISTRATION_PREVIEW_ENABLED==='true'
  &&env.TV3_WRITE_SCOPE_MODE==='manual-test'&&snapshot.source==='supabase'
  &&snapshot.period.status==='OPEN'
  &&draftWriteScopeAllowed(snapshot.period.id,snapshot.period.branch_id,env);
}
