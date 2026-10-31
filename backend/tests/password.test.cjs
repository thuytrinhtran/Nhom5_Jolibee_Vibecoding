const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scryptSync}=require('node:crypto');
process.env.NODE_ENV='test';
const app=require('../dist/server.js').default;
const config=require('../dist/config/supabase.js');
const {requirePasswordChanged,passwordLoginAfter}=require('../dist/middleware/auth.middleware.js');
const {validPassword}=require('../dist/routes/password.routes.js');
const {selectNames}=require('../scripts/temporary-passwords.cjs');

const fixtureNames={js_ld_003:'NEW',js_ld_004:'REGULAR',js_ld_005:'CREW_TRAINING',js_ld_007:'CREW_LEADER'};
async function scenario(run){
 const original={getUser:config.supabaseAdmin.auth.getUser,from:config.supabaseAdmin.from,signOut:config.supabaseAdmin.auth.admin.signOut,userAuthRequest:config.userAuthRequest,createAuthClient:config.createAuthClient};
 const token='fixture.'+Buffer.from(JSON.stringify({amr:[{method:'password',timestamp:200}]})).toString('base64url')+'.fixture';
 const state={password:'Temporary-Fixture-Aa1!',failState:false,nonceRequired:false,calls:0};
 const marker={id:'fixture-reset',salt:'fixture-salt',hash:scryptSync(state.password,'fixture-salt',32).toString('hex'),issued_at:100};
 const profile={id:'fixture-user',username:'js_ld_003',role:'NV',branch_id:null,is_active:true,must_change_password:true,password_reset_id:marker.id};
 const identity=()=>({id:profile.id,email:'fixture@example.invalid',user_metadata:state.userMetadata||{},app_metadata:{jollishift_password_reset:marker}});
 config.supabaseAdmin.auth.getUser=async()=>({data:{user:identity()},error:null});
 config.supabaseAdmin.auth.admin.signOut=async()=>({error:null});
 config.supabaseAdmin.from=table=>{
  let updating=false,filters={};
  const q={select(){return this;},eq(k,v){filters[k]=v;return this;},update(){updating=true;return this;},
   async single(){return{data:{...profile},error:null};},
   async maybeSingle(){if(!updating)return{data:table==='employees'?{id:'fixture-employee',skill_level:fixtureNames[profile.username],departments:null}:null,error:null};
    if(state.failState)return{data:null,error:{code:'fixture-outage'}};
    if(state.resetDuringWrite)profile.password_reset_id='newer-reset';
    if(profile.password_reset_id!==filters.password_reset_id||profile.must_change_password!==filters.must_change_password)return{data:null,error:null};
    profile.must_change_password=false;return{data:{id:profile.id},error:null};
   }};return q;
 };
 config.createAuthClient=()=>({auth:{signInWithPassword:async({password})=>password===state.password?{data:{user:identity(),session:{access_token:token,refresh_token:'fixture-refresh',expires_at:9999999999}},error:null}:{data:{user:null,session:null},error:{status:400}}}});
 config.userAuthRequest=async(_token,path,body)=>{
  if(path==='/reauthenticate')return{ok:true,status:200,data:{}};
  state.calls++;
  if(state.nonceRequired&&body.nonce!=='fixture-nonce')return{ok:false,status:400,data:{code:'reauthentication_needed'}};
  if(body.password===state.password)return{ok:false,status:422,data:{code:'same_password'}};
  state.password=body.password;return{ok:true,status:200,data:{id:profile.id}};
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/auth`;
 const request=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};};
 try{await run({state,profile,marker,request});}finally{Object.assign(config,{userAuthRequest:original.userAuthRequest,createAuthClient:original.createAuthClient});config.supabaseAdmin.auth.getUser=original.getUser;config.supabaseAdmin.from=original.from;config.supabaseAdmin.auth.admin.signOut=original.signOut;await new Promise(resolve=>server.close(resolve));}
}
for(const [username,skill]of Object.entries(fixtureNames))test(`isolated lifecycle ${username} / ${skill}`,async()=>scenario(async({profile,state,request})=>{
 profile.username=username;
 const old=state.password;
 const login=await request('/login',{email:'fixture@example.invalid',password:old});assert.equal(login.status,200);assert.equal(login.data.user.must_change_password,true);
 for(const path of ['/test/employee-only','/test/manager-only','/test/supervisor-only']){const r=await request(path);assert.equal(r.status,403);assert.equal(r.data.code,'PASSWORD_CHANGE_REQUIRED');}
 assert.equal((await request('/me')).status,200);
 assert.equal((await request('/password-policy')).status,200);
 const next='New-Fixture-Password-Aa1!';
 assert.equal((await request('/change-password',{password:next,confirmation:next})).status,200);
 assert.equal(profile.must_change_password,false);
 assert.equal((await request('/test/employee-only')).status,200);
 assert.equal((await request('/logout',{})).status,200);
 assert.equal((await request('/login',{email:'fixture@example.invalid',password:old})).status,401);
 assert.equal((await request('/login',{email:'fixture@example.invalid',password:next})).status,200);
}));
test('state update failure retries with verified new password, never temporary password',async()=>scenario(async({state,profile,request})=>{
 const next='New-Fixture-Password-Aa1!';state.failState=true;
 const first=await request('/change-password',{password:next,confirmation:next});assert.equal(first.status,503);assert.equal(first.data.code,'PASSWORD_STATE_PENDING');assert.equal(profile.must_change_password,true);
 state.failState=false;assert.equal((await request('/change-password',{password:next,confirmation:next})).status,200);assert.equal(profile.must_change_password,false);
}));
test('temporary reuse, weak and mismatched passwords cannot clear state',async()=>scenario(async({state,profile,request})=>{
 for(const body of [{password:state.password,confirmation:state.password},{password:'weak',confirmation:'weak'},{password:'Strong-Fixture-Aa1!',confirmation:'other'}])assert.equal((await request('/change-password',body)).status,400);
 assert.equal(state.calls,0);assert.equal(profile.must_change_password,true);
}));
test('Supabase reauthentication is honored, nonce forwarded',async()=>scenario(async({state,profile,request})=>{
 state.nonceRequired=true;const next='New-Fixture-Password-Aa1!';
 const first=await request('/change-password',{password:next,confirmation:next});assert.equal(first.data.code,'REAUTHENTICATION_REQUIRED');assert.equal(profile.must_change_password,true);
 assert.equal((await request('/reauthenticate',{})).status,200);
 assert.equal((await request('/change-password',{password:next,confirmation:next,nonce:'fixture-nonce'})).status,200);
}));
test('incomplete reset does not update Auth or clear state',async()=>scenario(async({marker,state,profile,request})=>{
 marker.id='different-reset';const next='New-Fixture-Password-Aa1!';const r=await request('/change-password',{password:next,confirmation:next});assert.equal(r.data.code,'RESET_NOT_READY');assert.equal(state.calls,0);assert.equal(profile.must_change_password,true);
}));
test('guards fail closed; refresh does not count as a fresh password login',()=>{
 let status;requirePasswordChanged({user:{must_change_password:true}},{status(n){status=n;return this;},json(){}},()=>assert.fail('must not pass'));assert.equal(status,403);
 const jwt=body=>'x.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.x';
 assert.equal(passwordLoginAfter(jwt({iat:300,amr:[{method:'password',timestamp:90}]}),100),false);
 assert.equal(passwordLoginAfter(jwt({amr:[{method:'password',timestamp:200}]}),100),true);
 assert.equal(passwordLoginAfter('invalid',100),false);
 assert.equal(validPassword('weak'),false);
 assert.throws(()=>selectNames(''),/1-4/);assert.deepEqual(selectNames('trangiahan'),['trangiahan']);assert.throws(()=>selectNames('js_ld_003,js_ld_004,js_ld_005,js_ld_007,js_ld_008'),/1-4/);
});

test('a stale session is denied even after the public flag was cleared',async()=>scenario(async({marker,profile,request})=>{
 profile.must_change_password=false;marker.issued_at=300;
 const r=await request('/test/employee-only');assert.equal(r.status,401);assert.equal(r.data.code,'FRESH_LOGIN_REQUIRED');
}));
test('self-edited user_metadata cannot bypass trusted public state',async()=>scenario(async({state,request})=>{
 state.userMetadata={must_change_password:false,role:'GS'};
 assert.equal((await request('/me')).data.user.must_change_password,true);
 assert.equal((await request('/test/employee-only')).data.code,'PASSWORD_CHANGE_REQUIRED');
}));
test('a newer reset cannot be cleared by an older change request',async()=>scenario(async({state,profile,request})=>{
 state.resetDuringWrite=true;const password='New-Fixture-Password-Aa1!';
 const r=await request('/change-password',{password,confirmation:password});
 assert.equal(r.status,503);assert.equal(profile.must_change_password,true);assert.equal(profile.password_reset_id,'newer-reset');
}));
