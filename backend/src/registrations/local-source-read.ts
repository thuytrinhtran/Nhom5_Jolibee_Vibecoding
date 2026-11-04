import { acquireLocalProjectClient } from '../services/tv5-local-rpc.js';
import { devImportContext,devImportHeaders,DEV_IMPORT_PERIOD,DEV_IMPORT_BRANCH } from './dev-import-policy.js';
// Same materialized receipt/header/row checks already deployed by 20261106.
// This read path preserves raw headers (including invalid/ineligible ones) and
// their exact provenance flags; it does not substitute Rule Engine eligibility.
export const LOCAL_SOURCE_SQL=`WITH p AS MATERIALIZED (
 SELECT * FROM public.registration_periods WHERE id=$1 AND branch_id=$2
), approved_batches AS MATERIALIZED (
 SELECT b.* FROM public.dev_import_batches b JOIN p ON b.period_id=p.id AND b.branch_id=p.branch_id
 WHERE p.work_start_date=date '2026-11-02' AND p.work_end_date=date '2026-11-08'
 AND public.dev_import_context_matches(b)
), approved_headers AS MATERIALIZED (
 SELECT h.period_id,h.employee_id,h.sample_batch_id,b.manifest FROM approved_batches b
 JOIN public.registration_submissions h ON h.period_id=b.period_id AND h.sample_batch_id=b.batch_id
 WHERE b.manifest->'after_images'->'registration_submissions' @> jsonb_build_array(public.dev_import_utc_image(h))
), approved_row_images AS MATERIALIZED (
 SELECT b.batch_id,x.image FROM approved_batches b
 CROSS JOIN LATERAL jsonb_array_elements(b.manifest->'after_images'->'shift_registrations') x(image)
), approved_rows AS MATERIALIZED (
 SELECT DISTINCT r.id FROM public.shift_registrations r JOIN approved_headers h USING(period_id,employee_id)
 JOIN approved_row_images x ON x.batch_id=h.sample_batch_id AND x.image->>'id'=r.id::text
 WHERE x.image @> public.dev_import_utc_image(r)
) SELECT jsonb_build_object('headers',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'employee_id',h.employee_id,'status',h.status,'submitted_at',h.submitted_at,'updated_at',h.updated_at,'sample_batch_id',h.sample_batch_id,
 'dev_import_allowed',EXISTS(SELECT 1 FROM approved_headers a WHERE a.period_id=h.period_id AND a.employee_id=h.employee_id AND a.sample_batch_id=h.sample_batch_id)) ORDER BY h.employee_id)
 FROM public.registration_submissions_sourced h WHERE h.period_id=$1),'[]'),
 'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'period_id',r.period_id,'employee_id',r.employee_id,'work_date',r.work_date,'shift_id',r.shift_id,'status',r.status,'submitted_at',r.submitted_at,
 'dev_import_allowed',EXISTS(SELECT 1 FROM approved_rows a WHERE a.id=r.id)) ORDER BY r.id)
 FROM public.shift_registrations r WHERE r.period_id=$1 AND r.status='VALID'),'[]')) result`;
export function localSourceReadEnabled(periodId:string){return process.env.TV2_LOCAL_SOURCE_READ_ENABLED==='true'&&periodId===DEV_IMPORT_PERIOD&&!!devImportContext();}
export async function readLocalSource(periodId:string){
 if(!localSourceReadEnabled(periodId))throw Error('LOCAL_SOURCE_NOT_ALLOWED');
 const c=await acquireLocalProjectClient();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   await c.query("SET LOCAL timezone='UTC'; SET LOCAL jit=off; SET LOCAL enable_nestloop=off; SET LOCAL plan_cache_mode=force_custom_plan; SET LOCAL statement_timeout='8s'");
   await c.query("SELECT set_config('request.headers',$1,true)",[JSON.stringify(devImportHeaders())]);
   const result=(await c.query(LOCAL_SOURCE_SQL,[periodId,DEV_IMPORT_BRANCH])).rows[0].result;
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}
 }finally{await c.end();}
}
