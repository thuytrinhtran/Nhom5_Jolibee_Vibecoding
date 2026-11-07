import { openRegistrationPreviewAllowed } from './manual-preview-policy.js';
import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
// Explicit, scoped preview only. OPEN data can never enable persistence/workflow.
export function developmentPreviewAllowed(snapshot:SummarySnapshot,env:NodeJS.ProcessEnv=process.env):boolean {
 return openRegistrationPreviewAllowed(snapshot,env);
}
