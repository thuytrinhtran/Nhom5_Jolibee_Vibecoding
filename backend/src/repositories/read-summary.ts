import type { RegistrationSummaryRepository } from './registration-summary.types.js';
import { coalesceRead } from '../services/read-coalescing.js';
import { devImportContext } from '../registrations/dev-import-policy.js';
export function readSummarySnapshot(repository:RegistrationSummaryRepository,branchId:string,periodId:string){
 if(repository.source!=='supabase')return repository.load(branchId,periodId);
 return coalesceRead(JSON.stringify(['summary',process.env.SUPABASE_URL,devImportContext(),branchId,periodId]),()=>repository.load(branchId,periodId));
}
