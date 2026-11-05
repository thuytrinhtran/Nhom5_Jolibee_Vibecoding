// Read existing application data only. No generation, AI evaluation or persistence calls.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {listSchedulingPeriods,readSchedulingContext,readDraft}=require('../dist/services/scheduling.service.js');
async function main(){
 if(process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')!=='https://wlbpprpiieonjrqglicv.supabase.co')throw Error('PROJECT_MISMATCH');
 const branch='11111111-1111-1111-1111-111111111111',period='79a979cc-8347-48b5-a411-f03bd8aceb92';
 const [profile,store,periods]=await Promise.all([db.from('users').select('id,username,role,branch_id').eq('username','ql_jollibee').eq('branch_id',branch).single(),db.from('branches').select('name').eq('id',branch).single(),listSchedulingPeriods(branch)]);
 if(profile.error||store.error||profile.data.role!=='QL')throw Error('PROFILE_NOT_VERIFIED');
 const target=periods.find(p=>p.id===period);if(!target)throw Error('PERIOD_NOT_FOUND');
 const latest=[...target.schedules].sort((a,b)=>b.version-a.version)[0];if(!latest)throw Error('NO_EXISTING_SCHEDULE');
 const [context,saved]=await Promise.all([readSchedulingContext(period,branch),readDraft(latest.id,branch)]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jolli-manager-readonly-'));fs.writeFileSync(path.join(dir,'snapshot.json'),JSON.stringify({user:{...profile.data,branch_name:store.data.name},periods:[target],context,saved}));
 const report={checked_at:new Date().toISOString(),project_ref:'wlbpprpiieonjrqglicv',period:'02–08/11/2026',status:saved.schedule.status,assignments:saved.assignments.length,requirements:context.requirements.length,read_only:true};
 fs.writeFileSync(path.resolve(__dirname,'../../docs/manager-planner-20261103/read-evidence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));console.log('SNAPSHOT_DIRECTORY='+dir);
}
main().catch(()=>{console.error('READ_ONLY_MANAGER_SNAPSHOT_FAILED');process.exitCode=1;});
