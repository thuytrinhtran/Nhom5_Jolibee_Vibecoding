-- Notifications only, emitted atomically from the existing idempotent operation audit.
-- No historical notification backfill or business-row updates; public RPC unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$ DECLARE grantee_name text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv5_mutate(uuid,text,uuid,jsonb)') AND md5(replace(prosrc,chr(13),''))='4a0b8049f339459a1659a95699910af6' AND pg_get_userbyid(proowner)='postgres' AND prosecdef) THEN RAISE EXCEPTION 'TV5_NOTIFICATION_DEPENDENCY_REVIEW_REQUIRED'; END IF;
 IF (EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv5_notify_operation_v1()') AND md5(replace(prosrc,chr(13),''))='756188a97a890b2911c6f108db5b64ae' AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v' AND prorettype='trigger'::regtype AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv5_notify_operation_v1()') AND a.grantee<>p.proowner)) AND (EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND tgname='tv5_operation_notifications' AND tgfoid=to_regprocedure('public.tv5_notify_operation_v1()') AND tgtype=5 AND tgenabled='O' AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0)) THEN RETURN; END IF;
 IF NOT (to_regprocedure('public.tv5_notify_operation_v1()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND tgname='tv5_operation_notifications')) THEN RAISE EXCEPTION 'TV5_NOTIFICATION_REVIEW_REQUIRED'; END IF;
 EXECUTE $function$CREATE FUNCTION public.tv5_notify_operation_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payload jsonb; result jsonb; kind text; assignment_id uuid; source_branch uuid; owner_user uuid;
 target_user uuid; work_day date; source_label text; recipients uuid[]:='{}'; recipient uuid;
 notification_type text; title text; content text; request_id uuid;
BEGIN
 IF NEW.entity_type<>'tv5_operations' OR NEW.action NOT IN ('CREATE_REQUEST','REPORT','INVITE','ACCEPT','DECLINE','APPROVE','REJECT','EXPIRE') THEN RETURN NEW; END IF;
 payload:=NEW.new_data->'request_data';result:=NEW.new_data->'response';
 request_id:=(NEW.new_data->>'request_id')::uuid;
 IF request_id IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR jsonb_typeof(result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_TV5_NOTIFICATION_EVENT'; END IF;
 IF NEW.action='CREATE_REQUEST' OR payload->>'kind'='REQUEST' OR (NEW.action IN ('ACCEPT','DECLINE') AND result->>'shift_change_request_id' IS NOT NULL) THEN kind:='REQUEST';
 ELSE kind:='INCIDENT'; END IF;
 IF kind='REQUEST' THEN SELECT original_assignment_id INTO assignment_id FROM public.shift_change_requests WHERE id=NEW.entity_id;
 ELSE SELECT original_assignment_id INTO assignment_id FROM public.incidents WHERE id=NEW.entity_id; END IF;
 SELECT a.actual_branch_id,e.user_id,a.work_date INTO source_branch,owner_user,work_day FROM public.shift_assignments a JOIN public.employees e ON e.id=a.employee_id WHERE a.id=assignment_id;
 IF source_branch IS NULL OR owner_user IS NULL THEN RAISE EXCEPTION 'INVALID_TV5_NOTIFICATION_SOURCE'; END IF;
 source_label:=CASE WHEN kind='REQUEST' THEN 'yêu cầu đổi ca' ELSE 'báo cáo sự cố' END;
 notification_type:='TV5_'||NEW.action;
 IF NEW.action IN ('CREATE_REQUEST','REPORT') THEN
  SELECT coalesce(array_agg(u.id),'{}') INTO recipients FROM public.users u WHERE u.branch_id=source_branch AND u.role='QL' AND u.is_active;
  title:=CASE WHEN kind='REQUEST' THEN 'Có yêu cầu đổi ca mới' ELSE 'Có báo cáo sự cố ca làm' END;
 ELSIF NEW.action='INVITE' THEN
  SELECT user_id INTO target_user FROM public.employees WHERE id=(result->>'target_employee_id')::uuid;
  recipients:=ARRAY[target_user];title:='Bạn được mời nhận ca';
 ELSIF NEW.action IN ('ACCEPT','DECLINE') THEN
  SELECT coalesce(array_agg(u.id),'{}') INTO recipients FROM public.users u WHERE u.branch_id=source_branch AND u.role='QL' AND u.is_active;
  title:=CASE WHEN result->>'status'='ACCEPTED' THEN 'Nhân viên đã nhận lời mời' WHEN result->>'status'='DECLINED' THEN 'Nhân viên từ chối lời mời' ELSE 'Lời mời đã hết hiệu lực' END;
 ELSIF NEW.action='APPROVE' THEN
  SELECT e.user_id INTO target_user FROM public.employees e WHERE e.id=(result->'new_assignment'->>'employee_id')::uuid;
  recipients:=ARRAY[owner_user,target_user];title:='Đã phê duyệt thay người làm ca';
 ELSIF NEW.action='REJECT' THEN recipients:=ARRAY[owner_user];title:=CASE WHEN kind='REQUEST' THEN 'Yêu cầu đổi ca đã bị từ chối' ELSE 'Báo cáo đã được xử lý: không giải quyết' END;
 ELSE
  IF result->>'status' NOT IN ('REJECTED','UNRESOLVED','EXPIRED') OR result->>'status' IS NULL THEN RETURN NEW; END IF;
  recipients:=ARRAY[owner_user];title:='Yêu cầu đã kết thúc, lịch không thay đổi';
 END IF;
 content:=format('Ca ngày %s; %s %s. Trạng thái: %s. Mở mục Yêu cầu và hỗ trợ để xem chi tiết.',work_day,source_label,NEW.entity_id,coalesce(result->>'status','đã ghi nhận'));
 IF NEW.action IN ('REJECT','EXPIRE') AND coalesce(result->>'decision_reason','')<>'' THEN content:=content||' Lý do: '||(result->>'decision_reason'); END IF;
 FOR recipient IN SELECT DISTINCT x.id FROM unnest(recipients) x(id) JOIN public.users u ON u.id=x.id WHERE u.is_active AND x.id IS NOT NULL LOOP
  INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
   VALUES(recipient,notification_type,title,content,'tv5-'||request_id::text||'-'||recipient::text) ON CONFLICT(idempotency_key) DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;$function$;
 ALTER FUNCTION public.tv5_notify_operation_v1() OWNER TO postgres;
 REVOKE ALL ON FUNCTION public.tv5_notify_operation_v1() FROM PUBLIC,anon,authenticated,service_role;
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='public.tv5_notify_operation_v1()'::regprocedure AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.tv5_notify_operation_v1() FROM %I',grantee_name);
 END LOOP;
 CREATE TRIGGER tv5_operation_notifications AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.tv5_notify_operation_v1();
 IF NOT ((EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv5_notify_operation_v1()') AND md5(replace(prosrc,chr(13),''))='756188a97a890b2911c6f108db5b64ae' AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v' AND prorettype='trigger'::regtype AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv5_notify_operation_v1()') AND a.grantee<>p.proowner)) AND (EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_logs'::regclass AND tgname='tv5_operation_notifications' AND tgfoid=to_regprocedure('public.tv5_notify_operation_v1()') AND tgtype=5 AND tgenabled='O' AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0))) THEN RAISE EXCEPTION 'TV5_NOTIFICATION_PATCH_FAILED'; END IF;
END $migration$;
COMMIT;
