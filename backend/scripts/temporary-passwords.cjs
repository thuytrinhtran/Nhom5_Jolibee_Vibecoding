/** Admin-only, 1-4 explicitly selected NV employees, Windows DPAPI handoff.
 * plan is read-only; apply requires the approved v2 checksum.
 * --recover-incomplete plans only malformed pending resets, never a valid pending reset.
 * Legacy sample plans must be reviewed again; existing completed accounts are not reset on resume.
 * Run one operator process per selected account. Resume only the SAME encrypted handoff.
 * A crash lock/checkpoint file requires operator inspection; never delete it automatically.
 * No apply/startup integration: provisioning is never run by application startup.
 */
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const { selectNames, digest, inspect, createPlan, validatePlan, prepareHandoff, applyAccount } = require('./lib/temporary-password-provisioning.cjs');
const check=(ok,message)=>{if(!ok)throw new Error(message);};
function dpapi(value,decrypt=false){
 check(process.platform==='win32','This handoff uses Windows DPAPI CurrentUser; run under the intended Windows operator');
 const command=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); `+(decrypt?`$b=[Convert]::FromBase64String($v.Trim()); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))`:`$b=[Text.Encoding]::UTF8.GetBytes($v); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))`);
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:value,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 check(r.status===0,'Cannot encrypt/decrypt handoff for this Windows account; no plaintext logged');return r.stdout.trim();
}
async function connection(){require('dotenv').config({path:path.resolve(__dirname,'../.env')});const url=(process.env.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;check(url&&key,'Missing server-only Supabase configuration');return{url,client:require('@supabase/supabase-js').createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};}
// Only an operator invoking apply explicitly can issue credentials. No startup hook.
async function main(){
 const [mode='help',...args]=process.argv.slice(2);const arg=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 if(mode==='help'){console.log('plan --usernames a,b --out plan.local [--recover-incomplete] | apply --plan plan.local --approve SHA256 --handoff D:/private/passwords.dpapi.local [--resume]');return;}
 check(['plan','apply'].includes(mode),'Unknown mode');
 if(mode==='plan'){
  const names=selectNames(arg('--usernames'));const output=arg('--out');check(output,'Explicit plan output path required');
  const {url,client}=await connection();const rows=await inspect(client,names);
  const plan=createPlan(url,rows,args.includes('--recover-incomplete'));
  fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({mode:'READ_ONLY_PLAN',selected:names,approval_sha256:plan.approval_sha256}));return;
 }
 const file=arg('--plan');check(file,'Plan required');const plan=JSON.parse(fs.readFileSync(file,'utf8'));
 // Validate approval before reading any remote identity or writing a handoff.
 check(plan.version===2&&plan.purpose==='employee-temporary-passwords'&&plan.approval_sha256===digest(plan)&&arg('--approve')===plan.approval_sha256,'Reviewed v2 plan required; legacy plans must be reviewed again');
 const handoffPath=arg('--handoff');check(handoffPath&&path.isAbsolute(handoffPath)&&handoffPath.endsWith('.local'),'Absolute encrypted handoff path ending .local required');
 const projectRoot=fs.realpathSync(path.resolve(__dirname,'../..'));
 const parent=fs.realpathSync(path.dirname(handoffPath));const resolved=path.join(parent,path.basename(handoffPath));
 const relative=path.relative(projectRoot,resolved);
 check(relative&& (relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Store handoff outside repository, including junction targets');
 check(!fs.existsSync(resolved)||!fs.lstatSync(resolved).isSymbolicLink(),'Handoff cannot be a symbolic link');
 // Cross-process operator lock; a crash leaves it for manual inspection, never automatic deletion.
 const lock=resolved+'.lock';const lockFd=fs.openSync(lock,'wx',0o600);
 try{
  const {url,client}=await connection();validatePlan(plan,url,arg('--approve'));
  let handoff;
  if(args.includes('--resume'))handoff=JSON.parse(dpapi(fs.readFileSync(resolved,'utf8'),true));
  else{
   const rows=await inspect(client,plan.users.map(x=>x.username));
   handoff=prepareHandoff(plan,rows,Number(process.env.PASSWORD_MIN_LENGTH||12));
   fs.writeFileSync(resolved,dpapi(JSON.stringify(handoff)),{flag:'wx',mode:0o600});
  }
  check(handoff.plan===plan.approval_sha256&&handoff.accounts.length===plan.users.length&&new Set(handoff.accounts.map(x=>x.id)).size===plan.users.length,'Handoff does not match approved plan');
  const persist=async()=>{
   const temp=resolved+'.pending.local';
   fs.writeFileSync(temp,dpapi(JSON.stringify(handoff)),{flag:'wx',mode:0o600});
   fs.renameSync(temp,resolved);
  };
  for(const account of handoff.accounts){
   check(typeof account.password==='string'&&account.password.length>=32&&typeof account.salt==='string'&&account.salt.length>=8&&typeof account.reset_id==='string'&&Number.isInteger(account.issued_at),'Invalid encrypted handoff');
   const status=await applyAccount(client,plan,account,persist);
   console.log(account.username+': '+status);
  }
  const wait=Math.max(0,Math.max(...handoff.accounts.map(x=>x.issued_at))*1000-Date.now()+1000);
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  console.log('Done. Read-TemporaryPasswords.ps1 opens the encrypted handoff locally. No passwords printed.');
 }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
module.exports={selectNames,digest};if(require.main===module)main().catch(()=>{console.error('Provisioning stopped safely. Check plan/state and resume the same encrypted handoff when appropriate; no credentials logged.');process.exitCode=1;});
