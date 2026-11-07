-- Keep delivered notifications and all schedule/request/audit rows.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$ BEGIN
 IF (to_regprocedure('public.tv5_notify_operation_v1()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND tgname='tv5_operation_notifications')) THEN RETURN; END IF;
 IF NOT ((EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv5_notify_operation_v1()') AND md5(replace(prosrc,chr(13),''))='756188a97a890b2911c6f108db5b64ae' AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v' AND prorettype='trigger'::regtype AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv5_notify_operation_v1()') AND a.grantee<>p.proowner)) AND (EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND tgname='tv5_operation_notifications' AND tgfoid=to_regprocedure('public.tv5_notify_operation_v1()') AND tgtype=5 AND tgenabled='O' AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0))) THEN RAISE EXCEPTION 'TV5_NOTIFICATION_ROLLBACK_REVIEW_REQUIRED'; END IF;
 DROP TRIGGER tv5_operation_notifications ON public.audit_logs;
 DROP FUNCTION public.tv5_notify_operation_v1();
END $rollback$;
COMMIT;
