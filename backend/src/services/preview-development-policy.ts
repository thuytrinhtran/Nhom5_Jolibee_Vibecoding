import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
import { openRegistrationPreviewAllowed } from './manual-preview-policy.js';
// Preview-only exception. Never change the stored period or the write/workflow policy.
export function developmentPreviewAllowed(snapshot:SummarySnapshot,env:NodeJS.ProcessEnv=process.env):boolean {
 // Explicit operator modes/toggles use the stricter scoped remote policy.
 // Legacy development previews remain read-only and cannot enable persistence.
 if(env.TV3_WRITE_SCOPE_MODE!==undefined||env.TV3_OPEN_REGISTRATION_PREVIEW_ENABLED!==undefined)return openRegistrationPreviewAllowed(snapshot,env);
 return env.NODE_ENV==='development' && snapshot.source==='supabase'
  && snapshot.period.id==='7f48f53e-d707-4a32-9f15-eb32aeb0095a'
  && snapshot.period.status==='OPEN';
}
