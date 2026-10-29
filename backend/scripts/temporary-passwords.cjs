/** Admin-only, selected sample employees, Windows DPAPI handoff. Never run automatically. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const SAMPLE_BATCH='jollishift-foundation-70-v1';
const expectedSkills={js_ld_003:'NEW',js_ld_004:'REGULAR',js_ld_005:'CREW_TRAINING',js_ld_007:'CREW_LEADER'};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function check(ok,message){if(!ok)throw new Error(message);}
function digest(plan){const {approval_sha256,...body}=plan;return sha(JSON.stringify(body));}
function selectNames(csv){const names=csv?.split(',').map(x=>x.trim()).filter(Boolean)||[];check(names.length>=1&&names.length<=4&&new Set(names).size===names.length&&names.every(x=>/^js_(ld|hc)_\d{3}$/.test(x)),'Choose 1-4 explicit, unique sample usernames; no --all mode');return names;}
function dpapi(value,decrypt=false){
 check(process.platform==='win32','This handoff uses Windows DPAPI CurrentUser; run under the intended Windows operator');
 const command=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); `+(decrypt?`$b=[Convert]::FromBase64String($v.Trim()); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))`:`$b=[Text.Encoding]::UTF8.GetBytes($v); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))`);
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:value,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 check(r.status===0,'Cannot encrypt/decrypt handoff for this Windows account; no plaintext logged');return r.stdout.trim();
}
async function connection(){require('dotenv').config({path:path.resolve(__dirname,'../.env')});const url=(process.env.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;check(url&&key,'Missing server-only Supabase configuration');return{url,client:require('@supabase/supabase-js').createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};}
async function inspect(client,names){
 const {data,error}=await client.from('users').select('id,username,role,is_active,must_change_password,password_reset_id').in('username',names);
 check(!error,'Cannot read password state. Review/apply migration manually first; no resets performed');check(data.length===names.length,'One or more usernames do not exist');
 const result=[];
 for(const username of names){const row=data.find(x=>x.username===username);check(row.role==='NV'&&row.is_active,'Only active NV sample accounts can be selected');
 const a=await client.auth.admin.getUserById(row.id);check(!a.error&&a.data.user?.app_metadata?.seed_batch===SAMPLE_BATCH&&a.data.user.email,'Account is not from the approved sample batch');
 const e=await client.from('employees').select('skill_level').eq('user_id',row.id).single();check(!e.error,'Employee profile missing');if(expectedSkills[username])check(e.data.skill_level===expectedSkills[username],'Selected employee skill does not match test specification');
 result.push({profile:row,identity:a.data.user,skill:e.data.skill_level});}return result;
}
async function main(){
 const [mode='help',...args]=process.argv.slice(2);const arg=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 if(mode==='help'){console.log('plan --usernames a,b --out plan.local | apply --plan plan.local --approve SHA256 --handoff D:/private/passwords.dpapi.local [--resume]');return;}
 check(['plan','apply'].includes(mode),'Unknown mode');
 if(mode==='plan'){
  const names=selectNames(arg('--usernames'));const output=arg('--out');check(output,'Explicit plan output path required');const {url,client}=await connection();const rows=await inspect(client,names);
  check(rows.every(x=>x.profile.must_change_password===false),'Selected account already has a pending reset; resume the original encrypted handoff');
  const p={version:1,purpose:'selected-temporary-passwords',project:sha(url),users:rows.map(x=>({...x.profile,skill_level:x.skill}))};p.approval_sha256=digest(p);fs.writeFileSync(output,JSON.stringify(p,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode:'READ_ONLY_PLAN',selected:names,approval_sha256:p.approval_sha256}));return;
 }
 const file=arg('--plan');check(file,'Plan required');const plan=JSON.parse(fs.readFileSync(file,'utf8'));
 check(plan.purpose==='selected-temporary-passwords'&&plan.approval_sha256===digest(plan)&&arg('--approve')===plan.approval_sha256,'Reviewed plan checksum required; no resets performed');selectNames(plan.users.map(u=>u.username).join(','));
 const handoffPath=arg('--handoff');check(handoffPath&&path.isAbsolute(handoffPath)&&handoffPath.endsWith('.local'),'Absolute encrypted handoff path ending .local required');
 const projectRoot=path.resolve(__dirname,'../..');check(!path.resolve(handoffPath).toLowerCase().startsWith(projectRoot.toLowerCase()+path.sep),'Store handoff outside the repository');
 const {url,client}=await connection();check(plan.project===sha(url),'Wrong Supabase project');const selected=await inspect(client,plan.users.map(u=>u.username));
 let handoff;
 if(args.includes('--resume')){handoff=JSON.parse(dpapi(fs.readFileSync(handoffPath,'utf8'),true));check(handoff.plan===plan.approval_sha256,'Handoff belongs to another plan');}
 else{
  check(selected.every(x=>{const p=plan.users.find(u=>u.id===x.profile.id);return p&&x.profile.must_change_password===false&&x.profile.password_reset_id===p.password_reset_id;}),'State changed; regenerate/review plan');
  const minimum=Number(process.env.PASSWORD_MIN_LENGTH||12);check(Number.isInteger(minimum)&&minimum>=6&&minimum<=128,'Invalid password policy');
  handoff={plan:plan.approval_sha256,accounts:selected.map(x=>({id:x.profile.id,username:x.profile.username,email:x.identity.email,password:'Aa1!'+crypto.randomBytes(128).toString('base64url').slice(0,Math.max(32,minimum)-4),reset_id:crypto.randomUUID(),salt:crypto.randomBytes(16).toString('hex'),issued_at:Math.ceil(Date.now()/1000)}))};
  // Encrypt and persist BEFORE any remote writes, so a partial failure is recoverable.
  fs.writeFileSync(handoffPath,dpapi(JSON.stringify(handoff)),{flag:'wx',mode:0o600});
 }
 check(handoff.accounts.length===plan.users.length && new Set(handoff.accounts.map(a=>a.id)).size===plan.users.length,'Incomplete or duplicate handoff identities');
 for(const account of handoff.accounts){
  const current=selected.find(x=>x.profile.id===account.id);check(current&&current.profile.username===account.username,'Handoff identity mismatch');const previous=plan.users.find(x=>x.id===account.id);check(previous,'Unexpected handoff account');
  if(current.profile.password_reset_id===account.reset_id && current.profile.must_change_password===false){console.log(account.username+': already completed; not reset again');continue;}
  if(current.profile.password_reset_id!==account.reset_id){
   check(current.profile.must_change_password===false&&current.profile.password_reset_id===previous.password_reset_id,'Account has another reset in progress');
   let query=client.from('users').update({must_change_password:true,password_reset_id:account.reset_id}).eq('id',account.id).eq('must_change_password',false);
   query=previous.password_reset_id?query.eq('password_reset_id',previous.password_reset_id):query.is('password_reset_id',null);
   const state=await query.select('id').maybeSingle();check(!state.error&&state.data,'Could not lock selected account state; no password reset issued');
  }
  const fresh=await client.auth.admin.getUserById(account.id);check(!fresh.error,'Cannot verify current Auth identity');
  if(fresh.data.user.app_metadata?.jollishift_password_reset?.id!==account.reset_id){
   account.issued_at=Math.ceil(Date.now()/1000);
   const temporaryPath=handoffPath+'.pending.local';
   fs.writeFileSync(temporaryPath,dpapi(JSON.stringify(handoff)),{mode:0o600});
   fs.renameSync(temporaryPath,handoffPath);
   const hash=crypto.scryptSync(account.password,account.salt,32).toString('hex');
   const update=await client.auth.admin.updateUserById(account.id,{password:account.password,app_metadata:{...fresh.data.user.app_metadata,jollishift_password_reset:{id:account.reset_id,salt:account.salt,hash,issued_at:account.issued_at}}});
   check(!update.error,'Auth update failed. Account remains blocked safely; resume SAME plan and handoff. No password logged');
  }
  console.log(account.username+': temporary password issued; must change before business access');
 }
 const wait=Math.max(0,Math.max(...handoff.accounts.map(x=>x.issued_at))*1000-Date.now()+1000);if(wait)await new Promise(r=>setTimeout(r,wait));
 console.log('Done. Use Read-TemporaryPasswords.ps1 locally under this Windows account. No passwords printed.');
}
module.exports={selectNames,digest};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
