/** Local SQL artifact generation ONLY. No network, database client or execution. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const projectRef='wimikwyuzhltpjciafod';
const projectUrl=`https://${projectRef}.supabase.co`;
const sources=['docs/Jollishift.sql','backend/migrations/20261029_require_password_change.sql','backend/migrations/20261029_employee_registration.sql','backend/migrations/20261029_registration_off_schedule.sql'];
const names=['01_foundation.sql','02_auth_compatibility.sql','03_tv2_m1.sql','04_tv2_m2.sql'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const header=`-- PREPARED ONLY: execute manually after review in jollishift-tv2-test.
-- TARGET: ${projectUrl} (project ref ${projectRef}).
-- SQL does not connect/switch project. Check the Dashboard URL before every Run.
-- Never run against the shared project. Apply this file once; stop on any error.
`;
function guard(step,dependency,previousHash){
 if(step==='01')return `DO $tv2_guard$ BEGIN
 IF to_regclass('auth.users') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')
 THEN RAISE EXCEPTION 'A fresh Supabase TEST project with built-in Auth/roles is required.'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
 THEN RAISE EXCEPTION 'STOP: public already has tables. Do not bootstrap an existing/shared database or rerun step 01.'; END IF;
END $tv2_guard$;
CREATE TABLE public.tv2_test_installation (
 step text PRIMARY KEY, project_ref text NOT NULL CHECK(project_ref='${projectRef}'),
 source_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE public.tv2_test_installation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv2_test_installation FROM PUBLIC,anon,authenticated,service_role;
`;
 return `DO $tv2_guard$ BEGIN
 IF to_regclass('public.tv2_test_installation') IS NULL THEN RAISE EXCEPTION 'Run this TEST bundle step 01 first; wrong/uninitialized project.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='${dependency}' AND project_ref='${projectRef}' AND source_sha256='${previousHash}')
 THEN RAISE EXCEPTION 'STOP: prerequisite ${dependency} or its checksum/project marker does not match this bundle.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='${step}') THEN RAISE EXCEPTION 'Step ${step} already applied. Inspect existing data; do not rerun.'; END IF;
END $tv2_guard$;
`;
}
function bodyOf(source){
 if(!/^BEGIN;/m.test(source)||!/COMMIT;\s*$/.test(source))throw Error('Expected transactional source SQL');
 return source.replace(/^BEGIN;\s*/m,'').replace(/COMMIT;\s*$/,'').trim();
}
function buildTestProjectBundle(outputDirectory=path.join(root,'docs/tv2-test',projectRef)){
 const directory=path.resolve(outputDirectory);fs.mkdirSync(directory,{recursive:true});
 const artifacts=[];let previousHash;
 for(let i=0;i<sources.length;i++){
  const source=fs.readFileSync(path.join(root,sources[i]),'utf8'),digest=hash(source),step=String(i+1).padStart(2,'0');
  let body=bodyOf(source);
  if(i===0){
   const duplicate=/^CREATE INDEX idx_schedule_approvals_schedule ON public\.schedule_approvals\(schedule_id, decided_at\);\r?$/m;
   if(!duplicate.test(body))throw Error('Foundation index layout changed; review the TEST-only adjustment.');
   body=body.replace(duplicate,'-- TEST copy only: redundant second idx_schedule_approvals_schedule declaration removed.');
  }
  const sql=header+`-- SOURCE: ${sources[i]}\nBEGIN;\n`+guard(step,i?String(i).padStart(2,'0'):null,previousHash)+body+`\nINSERT INTO public.tv2_test_installation(step,project_ref,source_sha256) VALUES('${step}','${projectRef}','${digest}');\nCOMMIT;\n`;
  fs.writeFileSync(path.join(directory,names[i]),sql,'utf8');artifacts.push({file:names[i],source:sources[i],source_sha256:digest,sha256:hash(sql),step});previousHash=digest;
 }
 const fixture=`DO $tv2_fixture$
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
END $tv2_fixture$;`;
 const digest=hash(fixture);
 const fixtureSql=header+`-- Create Auth user after step 04. Prefix this SAME Run with SET app.tv2_test_auth_user_id='UUID_FROM_TEST_AUTH';\nBEGIN;\n`+guard('05','04',previousHash)+fixture+`\nINSERT INTO public.tv2_test_installation(step,project_ref,source_sha256,details)
 VALUES('05','${projectRef}','${digest}',jsonb_build_object('auth_user_id',current_setting('app.tv2_test_auth_user_id'),'username','tv2_test_nv','period_id','7f330000-0000-4000-8000-000000000002','fixture_only',true));\nCOMMIT;\n`;
 fs.writeFileSync(path.join(directory,'05_test_fixture.sql'),fixtureSql,'utf8');artifacts.push({file:'05_test_fixture.sql',step:'05',sha256:hash(fixtureSql),source_sha256:digest});
 const verify=header+`-- READ ONLY: safe to repeat. This file never calls the save/automation RPCs.
SELECT step,project_ref,source_sha256,applied_at FROM public.tv2_test_installation ORDER BY step;
SELECT u.username,u.role,u.is_active,u.must_change_password,e.id AS employee_id,e.skill_level,e.status,
 e.branch_id=u.branch_id AS branch_matches,e.department_id,
 EXISTS(SELECT 1 FROM auth.users a WHERE a.id=u.id) AS auth_user_exists,
 EXISTS(SELECT 1 FROM auth.users a WHERE a.id=u.id AND a.email_confirmed_at IS NOT NULL) AS auth_email_confirmed
FROM public.users u JOIN public.employees e ON e.user_id=u.id WHERE u.username='tv2_test_nv';
SELECT id,name,start_time,end_time,is_active FROM public.shifts WHERE branch_id='7f330000-0000-4000-8000-000000000010' ORDER BY start_time;
SELECT id,work_start_date,work_end_date,status,open_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS opens_vietnam,
 close_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS closes_vietnam,
 status='OPEN' AND open_at<=clock_timestamp() AND close_at>clock_timestamp() AS editable_now
FROM public.registration_periods WHERE id='7f330000-0000-4000-8000-000000000002';
SELECT * FROM public.registration_schedule_config;
SELECT enabled AS automation_enabled FROM public.registration_automation_config;
SELECT status,submitted_at,updated_at FROM public.registration_submissions WHERE period_id='7f330000-0000-4000-8000-000000000002' AND employee_id='7f330000-0000-4000-8000-000000000012';
SELECT work_date,shift_id,status,submitted_at,updated_at FROM public.shift_registrations WHERE period_id='7f330000-0000-4000-8000-000000000002' AND employee_id='7f330000-0000-4000-8000-000000000012' ORDER BY work_date,shift_id;
`+fs.readFileSync(path.join(root,'docs/tv2-release/preflight.sql'),'utf8');
 fs.writeFileSync(path.join(directory,'06_verify.sql'),verify,'utf8');artifacts.push({file:'06_verify.sql',read_only:true,sha256:hash(verify)});
 const manifest={project_name:'jollishift-tv2-test',project_ref:projectRef,project_url:projectUrl,prepared_only:true,execution:'manual SQL Editor, files 01-04 once; create TEST Auth user; file 05 once; 06 read-only repeatable',guard_limit:'SQL cannot determine Dashboard project URL. Step 01 refuses any existing public tables; later steps require this bundle marker and predecessor checksum. Operator must verify project identity.',foundation_adjustment:'Only the TEST copy removes the redundant second idx_schedule_approvals_schedule declaration. Original docs/Jollishift.sql is unchanged.',artifacts};
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
 fs.writeFileSync(path.join(directory,'backend-env.example.txt'),`# FUTURE TEST setup only. Save privately as backend/.env.tv2-test after SQL is prepared.\nTV2_DATABASE_ENV=isolated-test\nTV2_TEST_PROJECT_REF=${projectRef}\nSUPABASE_URL=${projectUrl}\nSUPABASE_SECRET_KEY=REPLACE_WITH_TEST_SERVER_KEY\nSUPABASE_SERVICE_ROLE_KEY=\nSUPABASE_ANON_KEY=\nPORT=5001\nFRONTEND_URL=http://localhost:5174\nPASSWORD_MIN_LENGTH=12\nPASSWORD_REQUIRED_GROUPS=lower,upper,digit,symbol\n`,'utf8');
 return{directory,manifest};
}
if(require.main===module){const result=buildTestProjectBundle(process.argv[2]);console.log(`Prepared SQL artifacts only: ${result.directory}. No SQL or network request was executed.`);}
module.exports={buildTestProjectBundle,projectRef,projectUrl};
