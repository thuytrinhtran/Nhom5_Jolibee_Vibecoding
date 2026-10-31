const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core = require('../scripts/lib/temporary-password-provisioning.cjs');
// All state and SDK calls below are in memory; no environment or network is read.
function fixture(username = 'trangiahan', pending = false) {
  const state = {
    profile: { id: 'fixture-id', username, role: 'NV', branch_id: 'branch', is_active: true, must_change_password: pending, password_reset_id: null },
    employee: { id: 'employee', user_id: 'fixture-id', branch_id: 'branch', status: 'ACTIVE', skill_level: 'REGULAR' },
    identity: { id: 'fixture-id', email: 'fixture@example.invalid', app_metadata: { unrelated: 'preserved' } },
    writes: 0, authWrites: 0, failPublic: false, failAuth: false,
  };
  const client = { from(table) {
    let values, names; const filters = [];
    const query = {
      select() { return this; }, in(_key,value) { names=value; return this; },
      eq(key,value) { filters.push([key,value]); return this; }, is(key,value) { return this.eq(key,value); },
      update(value) { values=value; return this; },
      async single() { return { data: structuredClone(state.employee), error: null }; },
      async maybeSingle() {
        if (values) {
          if (state.failPublic || !filters.every(([k,v])=>state.profile[k]===v)) return {data:null,error:{code:'fixture'}};
          Object.assign(state.profile,values);state.writes++;return {data:{id:state.profile.id},error:null};
        }
        return {data:null,error:null};
      },
      then(resolve,reject) { return Promise.resolve({data: table==='users' && names.includes(state.profile.username) ? [structuredClone(state.profile)] : [],error:null}).then(resolve,reject); },
    }; return query;
  }, auth: { admin: {
    async getUserById() { if(state.failNextRead){state.failNextRead=false;return {data:null,error:{code:'fixture'}};} return {data:{user:structuredClone(state.identity)},error:null}; },
    async updateUserById(id,values) { state.authWrites++; if(state.failAuth)return {error:{code:'fixture'}}; assert.equal(id,state.profile.id); state.identity.app_metadata=structuredClone(values.app_metadata);if(state.failVerification)state.failNextRead=true;return {data:{user:state.identity},error:null}; },
  } } };
  return {state,client};
}
async function prepare(f, recovery = false) {
  const rows = await core.inspect(f.client,[f.state.profile.username]);
  const plan = core.createPlan('https://fixture.invalid',rows,recovery);
  core.validatePlan(plan,'https://fixture.invalid',plan.approval_sha256);
  return {plan,handoff:core.prepareHandoff(plan,rows)};
}
for (const username of ['js_ld_004','trangiahan']) test(`common provisioning supports ${username} without seed metadata`,async()=>{
  const f=fixture(username);const {plan,handoff}=await prepare(f);let checkpoints=0;
  assert.equal(await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{checkpoints++;assert.equal(f.state.authWrites,0);}), 'issued');
  assert.equal(checkpoints,1);assert.equal(f.state.profile.must_change_password,true);
  const marker=f.state.identity.app_metadata.jollishift_password_reset;
  assert.equal(marker.id,f.state.profile.password_reset_id);assert.equal(f.state.identity.app_metadata.unrelated,'preserved');
  assert.equal(marker.hash,crypto.scryptSync(handoff.accounts[0].password,marker.salt,32).toString('hex'));
  assert.equal(f.state.profile.role,'NV');assert.equal(f.state.profile.id,'fixture-id');
  await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>assert.fail('no checkpoint on replay'));
  assert.equal(f.state.authWrites,1);
  f.state.profile.must_change_password=false;
  assert.equal(await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{}),'already-completed');
  assert.equal(f.state.authWrites,1);
});
test('incomplete pending state requires explicit recovery and never clears the gate',async()=>{
  const f=fixture('trangiahan',true);await assert.rejects(prepare(f),/Pending reset/);
  const {plan,handoff}=await prepare(f,true);await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{});
  assert.equal(f.state.profile.must_change_password,true);assert.equal(f.state.authWrites,1);
});
test('valid pending resets cannot be replaced through recovery',async()=>{
  const f=fixture();const {plan,handoff}=await prepare(f);await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{});
  await assert.rejects(prepare(f,true),/Recovery is only/);assert.equal(f.state.authWrites,1);
});
test('public reservation failure never changes Auth',async()=>{
  const f=fixture();const {plan,handoff}=await prepare(f);f.state.failPublic=true;
  await assert.rejects(core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{}),/reserve/);assert.equal(f.state.authWrites,0);
});
test('Auth failure stays blocked and resumes with same password/reset ID',async()=>{
  const f=fixture();const {plan,handoff}=await prepare(f);const password=handoff.accounts[0].password;
  f.state.failAuth=true;await assert.rejects(core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{}),/Auth update failed/);
  assert.equal(f.state.profile.must_change_password,true);const id=f.state.profile.password_reset_id;
  f.state.failAuth=false;await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{});
  assert.equal(f.state.profile.password_reset_id,id);assert.equal(handoff.accounts[0].password,password);
});
test('encrypted checkpoint failure prevents Auth issuance and remains recoverable',async()=>{
  const f=fixture();const {plan,handoff}=await prepare(f);
  await assert.rejects(core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{throw Error('disk');}),/disk/);
  assert.equal(f.state.authWrites,0);assert.equal(f.state.profile.must_change_password,true);
  await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{});assert.equal(f.state.authWrites,1);
});
test('lost verification after Auth success resumes without issuing password twice',async()=>{
  const f=fixture();const {plan,handoff}=await prepare(f);f.state.failVerification=true;
  await assert.rejects(core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{}));
  f.state.failVerification=false;
  assert.equal(await core.applyAccount(f.client,plan,handoff.accounts[0],async()=>{}),'already-issued');
  assert.equal(f.state.authWrites,1);
});
test('simultaneous competing plans allow only one reservation and Auth write',async()=>{
  const f=fixture();const a=await prepare(f),b=await prepare(f);
  const results=await Promise.allSettled([core.applyAccount(f.client,a.plan,a.handoff.accounts[0],async()=>{}),core.applyAccount(f.client,b.plan,b.handoff.accounts[0],async()=>{})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.state.authWrites,1);
});
test('concurrent plans and identity/branch drift are rejected',async()=>{
  const f=fixture();const a=await prepare(f),b=await prepare(f);
  await core.applyAccount(f.client,a.plan,a.handoff.accounts[0],async()=>{});
  await assert.rejects(core.applyAccount(f.client,b.plan,b.handoff.accounts[0],async()=>{}),/changed|progress/);
  f.state.employee.branch_id='other';await assert.rejects(core.inspect(f.client,[f.state.profile.username]),/relationship/);
  assert.equal(f.state.authWrites,1);
});
test('invalid employees, role, inactive user and wrong approval/project fail closed',async()=>{
  for(const mutate of [s=>s.profile.role='QL',s=>s.profile.is_active=false,s=>s.employee.status='INACTIVE',s=>s.employee.user_id='other',s=>s.identity.id='other']){
    const f=fixture();mutate(f.state);await assert.rejects(prepare(f));assert.equal(f.state.authWrites,0);
  }
  const f=fixture();const {plan}=await prepare(f);
  assert.throws(()=>core.validatePlan(plan,'https://other.invalid',plan.approval_sha256));
  assert.throws(()=>core.validatePlan(plan,'https://fixture.invalid','wrong'));
  assert.throws(()=>core.selectNames('a,a'));assert.throws(()=>core.selectNames('a,b,c,d,e'));
});
