-- PREPARED ONLY: execute manually after review in jollishift-tv2-test.
-- TARGET: https://wimikwyuzhltpjciafod.supabase.co (project ref wimikwyuzhltpjciafod).
-- SQL does not connect/switch project. Check the Dashboard URL before every Run.
-- Never run against the shared project. Apply this file once; stop on any error.
-- Create Auth user after step 04. Prefix this SAME Run with SET app.tv2_test_auth_user_id='UUID_FROM_TEST_AUTH';
BEGIN;
DO $tv2_guard$ BEGIN
 IF to_regclass('public.tv2_test_installation') IS NULL THEN RAISE EXCEPTION 'Run this TEST bundle step 01 first; wrong/uninitialized project.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='04' AND project_ref='wimikwyuzhltpjciafod' AND source_sha256='52142c9e6902a7b432a7d0b7b403349877ad8bb0f6bd86fb75640af69cc935a9')
 THEN RAISE EXCEPTION 'STOP: prerequisite 04 or its checksum/project marker does not match this bundle.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='05') THEN RAISE EXCEPTION 'Step 05 already applied. Inspect existing data; do not rerun.'; END IF;
END $tv2_guard$;
DO $tv2_fixture$
DECLARE raw_uid text := current_setting('app.tv2_test_auth_user_id',true); uid uuid;
 branch uuid := '7f330000-0000-4000-8000-000000000010';
 department uuid := '7f330000-0000-4000-8000-000000000011';
 employee uuid := '7f330000-0000-4000-8000-000000000012';
 period uuid := '7f330000-0000-4000-8000-000000000002';
 monday date := date_trunc('week',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7;
BEGIN
 IF raw_uid IS NULL OR raw_uid !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Create a disposable TEST Auth user, then prefix THIS SAME Run with SET app.tv2_test_auth_user_id = its UUID.'; END IF;
 uid := raw_uid::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid) THEN RAISE EXCEPTION 'TEST Auth UUID does not exist in this project.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND email IS NOT NULL AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'The disposable TEST Auth user needs a confirmed email for the existing email/password login.'; END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=uid OR username='tv2_test_nv') THEN RAISE EXCEPTION 'User is already mapped; no existing account will be overwritten.'; END IF;
 IF EXISTS(SELECT 1 FROM public.registration_automation_config WHERE enabled) THEN RAISE EXCEPTION 'Automation must remain disabled during fixture setup.'; END IF;
 INSERT INTO public.branches(id,name) VALUES(branch,'TEST TV2 - Chi nhánh giả lập');
 INSERT INTO public.departments(id,name) VALUES(department,'TEST TV2 - Bộ phận giả lập');
 INSERT INTO public.users(id,username,role,branch_id) VALUES(uid,'tv2_test_nv','NV',branch);
 INSERT INTO public.employees(id,user_id,full_name,branch_id,department_id,skill_level)
 VALUES(employee,uid,'Nhân viên giả lập TV2 TEST',branch,department,'REGULAR');
 INSERT INTO public.shifts(id,name,start_time,end_time,branch_id,is_active) VALUES
 ('7f330000-0000-4000-8000-000000000003','TEST - Ca sáng','08:00','12:00',branch,true),
 ('7f330000-0000-4000-8000-000000000004','TEST - Ca chiều','12:00','17:00',branch,true),
 ('7f330000-0000-4000-8000-000000000005','TEST - Ca tối','17:00','22:00',branch,true);
 -- TEST fixture only: opens immediately for 2 hours. Official Friday configuration is unchanged.
 INSERT INTO public.registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status)
 VALUES(period,branch,monday,monday+6,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours','OPEN');
END $tv2_fixture$;
INSERT INTO public.tv2_test_installation(step,project_ref,source_sha256,details)
 VALUES('05','wimikwyuzhltpjciafod','2a8f3b3e6012461e44fee321eed37ed9c645ecae31b8b0824077dd8548f57808',jsonb_build_object('auth_user_id',current_setting('app.tv2_test_auth_user_id'),'username','tv2_test_nv','period_id','7f330000-0000-4000-8000-000000000002','fixture_only',true));
COMMIT;
