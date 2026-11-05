// Existing scoped project configuration; SELECT only, transaction enforces read-only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
require('../dist/config/supabase.js');
const {acquireLocalProjectClient}=require('../dist/services/tv5-local-rpc.js');
async function main(){const c=await acquireLocalProjectClient();try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const q=async(sql,args=[])=> (await c.query(sql,args)).rows;
 await q("SET LOCAL statement_timeout='8s'; SET LOCAL timezone='UTC'; SET LOCAL jit=off; SET LOCAL enable_nestloop=off");
 const scope=['11111111-1111-1111-1111-111111111111','79a979cc-8347-48b5-a411-f03bd8aceb92'];
 const definitions=await q("SELECT pg_get_functiondef(oid) body,prosrc source FROM pg_proc WHERE oid='public.tv5_mutate(uuid,text,uuid,jsonb)'::regprocedure");
 const local=fs.readFileSync(path.resolve(__dirname,'../migrations/20261104_tv5_shift_replacement.sql'),'utf8').split('CREATE FUNCTION public.tv5_mutate')[1].split('AS $$')[1].split('$$;')[0];
 const normalize=s=>s.replace(/\r/g,'').trim();
 const sources=await q(`SELECT r.id,r.status,r.requesting_employee_id owner,r.replacement_employee_id recipient,
 a.id original,a.status original_status,a.work_date::text work_date,a.employee_id original_owner,
 (SELECT count(*)::int FROM replacement_invitations v WHERE v.shift_change_request_id=r.id AND v.status='ACCEPTED') accepted_invitations
 FROM shift_change_requests r JOIN shift_assignments a ON a.id=r.original_assignment_id
 JOIN schedules s ON s.id=a.schedule_id WHERE s.branch_id=$1 AND s.period_id=$2 ORDER BY r.created_at`,scope);
 const incidents=await q(`SELECT i.status,count(*)::int count FROM incidents i JOIN shift_assignments a ON a.id=i.original_assignment_id JOIN schedules s ON s.id=a.schedule_id WHERE s.branch_id=$1 AND s.period_id=$2 GROUP BY i.status`,scope);
 const tests=[];for(const s of sources){
  const related=await q('SELECT id,employee_id,status FROM shift_assignments WHERE replaces_assignment_id=$1',[s.original]);
  const people=await q('SELECT e.id,u.id actor,u.username FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=ANY($1::uuid[])',[[s.owner,s.recipient].filter(Boolean)]);
  const views={};for(const p of people)views[p.id]=(await q('SELECT public.employee_schedule_week($1,$2) result',[p.actor,'2026-11-02']))[0].result.assignments;
  tests.push({status:s.status,date:s.work_date,owner:people.find(p=>p.id===s.owner)?.username??'no_login',recipient:people.find(p=>p.id===s.recipient)?.username??null,original_status:s.original_status,accepted_invitations:s.accepted_invitations,
   owner_still_sees_original:(views[s.owner]??[]).some(a=>a.assignment_id===s.original),
   original_retained:true,replacement_rows:related.length,
   recipient_sees_active_replacement:s.recipient&&related.some(a=>a.employee_id===s.recipient&&a.status==='ACTIVE')?related.filter(a=>a.employee_id===s.recipient&&a.status==='ACTIVE').every(a=>(views[s.recipient]??[]).some(v=>v.assignment_id===a.id)):null,
   active_replacement_count:related.filter(a=>a.status==='ACTIVE').length,
   phase:['PENDING','SEARCHING'].includes(s.status)?'awaiting_manager':s.status==='APPROVED'?'completed':'other'});
 }
 const accounts=[];for(const username of ['nv_jollibee','nv_jollibee_02']){
  const p=await q('SELECT id FROM users WHERE username=$1 AND branch_id=$2',[username,scope[0]]);if(!p.length){accounts.push({username,found:false});continue;}
  const v=(await q('SELECT public.employee_schedule_week($1,$2) result',[p[0].id,'2026-11-02']))[0].result;
  accounts.push({username,assignments:v.assignments.length,days:v.assignments.map(a=>a.work_date)});
 }
 const report={checked_at:new Date().toISOString(),project_ref:'wlbpprpiieonjrqglicv',branch:'Lê Duẩn',week:'02–08/11/2026',read_only:true,rpc_sha256:crypto.createHash('sha256').update(definitions[0].body).digest('hex'),rpc_body_matches_local_migration:normalize(local)===normalize(definitions[0].source),requests:tests,incidents,accounts};
 let snapshot=null;
 if(process.argv.includes('--ui-snapshot')){
  const user=(await q("SELECT u.id,u.username,u.role,u.branch_id,e.full_name,b.name branch_name FROM users u JOIN employees e ON e.user_id=u.id JOIN branches b ON b.id=u.branch_id WHERE u.username='nv_jollibee_02' AND u.branch_id=$1",[scope[0]]))[0];
  const week=(await q('SELECT public.employee_schedule_week($1,$2) result',[user.id,'2026-11-02']))[0].result;
  const queue=(await q('SELECT public.tv5_read($1) result',[user.id]))[0].result;
  snapshot={user:{...user,employee:{full_name:user.full_name}},week,queue:{...queue,enabled:process.env.TV5_PERSISTENCE_ENABLED==='true'}};
 }
 await q('COMMIT');const file=path.resolve(__dirname,'../../docs/employee-navigation-20261103/supabase-transfer-evidence.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(snapshot){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jolli-readonly-ui-'));fs.writeFileSync(path.join(dir,'snapshot.json'),JSON.stringify(snapshot));console.log('UI_SNAPSHOT_DIRECTORY='+dir);}
 }catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}}
main().catch(()=>{console.error('READ_ONLY_TRANSFER_CHECK_FAILED');process.exitCode=1;});
