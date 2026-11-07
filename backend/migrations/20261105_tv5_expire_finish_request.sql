-- Function-only patch: no table, enum, permission or assignment changes.
-- Preserve every other branch of the installed RPC. Fail closed on source drift.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE definition text; old_branch text:=$old$
  ELSIF p_action='EXPIRE' THEN
   WITH changed AS(UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
    WHERE ((kind='REQUEST' AND shift_change_request_id=source_id) OR (kind='INCIDENT' AND incident_id=source_id)) AND status='PENDING' AND expires_at<=clock_timestamp() RETURNING *)
   SELECT jsonb_build_object('expired',coalesce(jsonb_agg(to_jsonb(changed)),'[]')) INTO output FROM changed;
   IF jsonb_array_length(output->'expired')>0 THEN
   INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
    VALUES(u.id,'REPLACEMENT_SEARCH','Kiểm tra kết quả tìm người thay','Hãy kiểm tra các lời mời đã hết hạn và xác nhận hợp lệ cho yêu cầu '||source_id::text,'tv5-expire-'||p_request_id::text);
   END IF;
$old$; new_branch text:=$new$
  ELSIF p_action='EXPIRE' THEN
   IF kind='REQUEST' THEN
    -- Existing RPC locks serialize EXPIRE against ACCEPT/APPROVE and preserve replay.
    IF a.status='ACTIVE' AND s.status='PUBLISHED' AND r.assignment_snapshot=to_jsonb(a)
     AND NOT EXISTS(SELECT 1 FROM public.schedules n WHERE n.period_id=s.period_id AND n.status='PUBLISHED' AND (n.version>s.version OR n.schedule_group_id<>s.schedule_group_id))
     AND EXISTS(SELECT 1 FROM public.replacement_invitations i WHERE i.shift_change_request_id=source_id
      AND i.status='ACCEPTED' AND i.valid_when_confirmed IS TRUE AND i.responded_at IS NOT NULL AND i.responded_at<i.expires_at)
    THEN RAISE EXCEPTION 'REPLACEMENT_ALREADY_ACCEPTED'; END IF;
    IF a.status='ACTIVE' AND s.status='PUBLISHED' AND r.assignment_snapshot=to_jsonb(a)
     AND NOT EXISTS(SELECT 1 FROM public.schedules n WHERE n.period_id=s.period_id AND n.status='PUBLISHED' AND (n.version>s.version OR n.schedule_group_id<>s.schedule_group_id))
     AND NOT EXISTS(SELECT 1 FROM public.replacement_invitations i WHERE i.shift_change_request_id=source_id
      AND (i.status='EXPIRED' OR (i.status='PENDING' AND i.expires_at<=clock_timestamp())))
    THEN RAISE EXCEPTION 'NO_EXPIRED_INVITATIONS'; END IF;
    WITH closed AS(UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
     WHERE shift_change_request_id=source_id AND status IN ('PENDING','ACCEPTED') RETURNING *)
    SELECT jsonb_build_object('closed_invitations',coalesce(jsonb_agg(to_jsonb(closed)),'[]')) INTO output FROM closed;
    UPDATE public.shift_change_requests SET status='REJECTED',approved_by=u.id,resolved_at=clock_timestamp(),
     decision_reason='Không tìm được người thay' WHERE id=source_id RETURNING * INTO r;
    output:=to_jsonb(r)||output;
    INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
     SELECT e.user_id,'REPLACEMENT_SEARCH','Đã kết thúc yêu cầu đổi ca','Không tìm được người thay. Ca làm hiện tại không thay đổi.',
      'tv5-search-ended-'||source_id::text FROM public.employees e WHERE e.id=r.requesting_employee_id
     ON CONFLICT(idempotency_key) DO NOTHING;
   ELSE
    -- Incident handling is intentionally unchanged.
    WITH changed AS(UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
     WHERE incident_id=source_id AND status='PENDING' AND expires_at<=clock_timestamp() RETURNING *)
    SELECT jsonb_build_object('expired',coalesce(jsonb_agg(to_jsonb(changed)),'[]')) INTO output FROM changed;
    IF jsonb_array_length(output->'expired')>0 THEN
     INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
      VALUES(u.id,'REPLACEMENT_SEARCH','Kiểm tra kết quả tìm người thay','Hãy kiểm tra các lời mời đã hết hạn và xác nhận hợp lệ cho yêu cầu '||source_id::text,'tv5-expire-'||p_request_id::text);
    END IF;
   END IF;
$new$;
BEGIN
 SELECT pg_get_functiondef('public.tv5_mutate(uuid,text,uuid,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,E'\r\n',E'\n');
 old_branch:=ltrim(old_branch,E'\n');new_branch:=ltrim(new_branch,E'\n');
 IF strpos(definition,new_branch)>0 THEN RETURN; END IF;
 IF strpos(definition,old_branch)=0 THEN RAISE EXCEPTION 'TV5_EXPIRE_SOURCE_DRIFT'; END IF;
 EXECUTE replace(definition,old_branch,new_branch);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
