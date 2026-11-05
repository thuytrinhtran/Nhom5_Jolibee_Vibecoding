import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
// Preview-only exception. Never change the stored period or the write/workflow policy.
export function developmentPreviewAllowed(snapshot:SummarySnapshot):boolean {
 return process.env.NODE_ENV==='development' && snapshot.source==='supabase'
  && snapshot.period.id==='7f48f53e-d707-4a32-9f15-eb32aeb0095a'
  && snapshot.period.status==='OPEN';
}
