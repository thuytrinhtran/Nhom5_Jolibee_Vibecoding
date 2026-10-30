// Generates SQL for manual review only. Never connects to a database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../..');
const sources=['docs/Jollishift.sql','backend/migrations/20261029_require_password_change.sql','backend/migrations/20261029_employee_registration.sql','backend/migrations/20261029_registration_off_schedule.sql'];
const guard=`
DO $$ BEGIN
 IF current_setting('app.tv2_environment',true) IS DISTINCT FROM 'isolated-test'
 OR coalesce(current_setting('app.tv2_project_ref',true),'') IN ('','wlbpprpiieonjrqglicv')
 THEN RAISE EXCEPTION 'STOP: isolated TEST project settings required. Never run on shared project.'; END IF;
END $$;
`;
const sql=sources.map(file=>`-- SOURCE: ${file}\n`+fs.readFileSync(path.join(root,file),'utf8').replace('CREATE INDEX idx_schedule_approvals_schedule ON','CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule ON').replace('BEGIN;',()=>`BEGIN;${guard}`)).join('\n');
const output=path.resolve(process.argv[2]||path.join(os.tmpdir(),'jollishift-tv2-test-schema.sql'));
fs.writeFileSync(output,'-- EMPTY SUPABASE TEST PROJECT ONLY. Review before execution.\n'+sql,'utf8');
console.log(`Prepared SQL only (not executed): ${output}`);
