-- Separate TEST project only. Create a disposable Auth user in its Dashboard first.
-- Same session settings as seed.sql plus app.tv2_test_auth_user_id=<new TEST Auth UUID>.
BEGIN;
DO $$
DECLARE uid uuid := nullif(current_setting('app.tv2_test_auth_user_id',true),'')::uuid;
  branch uuid := '7f220000-0000-4000-8000-000000000010';
  department uuid := '7f220000-0000-4000-8000-000000000011';
  employee uuid := '7f220000-0000-4000-8000-000000000012';
BEGIN
 IF current_setting('app.tv2_environment',true) IS DISTINCT FROM 'isolated-test'
 OR coalesce(current_setting('app.tv2_project_ref',true),'') IN ('','wlbpprpiieonjrqglicv')
 THEN RAISE EXCEPTION 'STOP: isolated TEST project required.'; END IF;
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid) THEN RAISE EXCEPTION 'Create a new disposable TEST Auth user first.'; END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=uid OR username='tv2_test_nv')
 OR EXISTS(SELECT 1 FROM public.branches WHERE id=branch OR name='TEST TV2 branch')
 OR EXISTS(SELECT 1 FROM public.departments WHERE id=department OR name='TEST TV2 department')
 THEN RAISE EXCEPTION 'TEST identity or fixtures already exist; inspect them instead of overwriting.'; END IF;
 INSERT INTO public.branches(id,name) VALUES(branch,'TEST TV2 branch');
 INSERT INTO public.departments(id,name) VALUES(department,'TEST TV2 department');
 INSERT INTO public.users(id,username,role,branch_id) VALUES(uid,'tv2_test_nv','NV',branch);
 INSERT INTO public.employees(id,user_id,full_name,branch_id,department_id,skill_level)
 VALUES(employee,uid,'Nhân viên TEST TV2',branch,department,'REGULAR');
END $$;
COMMIT;
-- Login uses the TEST email/password created in its Auth dashboard, never a shared account.
