const {test}=require('node:test'),assert=require('node:assert/strict');
const {draftWriteScopeAllowed}=require('../dist/services/draft-write-scope.js');
const {DEV_IMPORT_PROJECT:project,DEV_IMPORT_BRANCH:branch,DEV_IMPORT_PERIOD:period}=require('../dist/registrations/dev-import-policy.js');
const env={TV3_WRITE_SCOPE_ENABLED:'true',NODE_ENV:'development',SUPABASE_URL:`https://${project}.supabase.co`,TV3_WRITE_PROJECT_REF:project,TV3_WRITE_BRANCH_ID:branch,TV3_WRITE_PERIOD_ID:period};

test('allowlist is authoritative, branch scoped, fail closed and accepts several explicitly approved periods',()=>{
 const next='e9245c5a-1f47-46ac-ab9e-65456ec1eb63',foreign='00000000-0000-4000-8000-000000000099';
 const approved={...env,TV3_WRITE_SCOPE_MODE:'allowlist',TV3_WRITE_SCOPE_ALLOWLIST:JSON.stringify([{branch_id:branch,period_ids:[period,next]}])};
 for(const p of [period,next])assert.equal(draftWriteScopeAllowed(p,branch,approved),true);
 assert.equal(draftWriteScopeAllowed(foreign,branch,approved),false);assert.equal(draftWriteScopeAllowed(period,foreign,approved),false);
 for(const raw of ['', '[]','{}','null','[{}]',JSON.stringify([{branch_id:branch,period_ids:['*']}])])assert.equal(draftWriteScopeAllowed(period,branch,{...approved,TV3_WRITE_SCOPE_ALLOWLIST:raw}),false);
 assert.equal(draftWriteScopeAllowed(period,branch,{...approved,TV3_WRITE_SCOPE_ENABLED:'false'}),false);
 assert.equal(draftWriteScopeAllowed(period,branch,{...approved,NODE_ENV:'production'}),true);
 assert.equal(draftWriteScopeAllowed(period,branch,{...approved,SUPABASE_URL:'https://wrong.supabase.co'}),false);
});
test('operator draft scope accepts only the approved project/branch/period',()=>{
 assert.equal(draftWriteScopeAllowed(period,branch,env),true);
 for(const [p,b] of [['other',branch],[period,'other'],[period,undefined]])assert.equal(draftWriteScopeAllowed(p,b,env),false);
 for(const override of [{SUPABASE_URL:'https://other.supabase.co'},{TV3_WRITE_PERIOD_ID:'other'},{TV3_WRITE_BRANCH_ID:'other'},{TV3_WRITE_PROJECT_REF:'other'},{NODE_ENV:'production'},{TV3_WRITE_SCOPE_ENABLED:'yes'}])assert.equal(draftWriteScopeAllowed(period,branch,{...env,...override}),false);
 assert.equal(draftWriteScopeAllowed('other','other',{}),false);
});

test('approved integration mode allows only the new period and rejects the published period even if scope is disabled',()=>{
 const testPeriod='0f38b6da-4552-4885-9c0b-dbb295e8ef8c';
 const integration={...env,TV3_WRITE_SCOPE_MODE:'integration-test',TV3_WRITE_PERIOD_ID:testPeriod};
 assert.equal(draftWriteScopeAllowed(testPeriod,branch,integration),true);
 assert.equal(draftWriteScopeAllowed(period,branch,integration),false);
 assert.equal(draftWriteScopeAllowed(testPeriod,branch,{...integration,TV3_WRITE_SCOPE_ENABLED:'false'}),false);
 assert.equal(draftWriteScopeAllowed(testPeriod,branch,{...integration,NODE_ENV:'production'}),false);
 assert.equal(draftWriteScopeAllowed(testPeriod,branch,{...integration,TV3_WRITE_PERIOD_ID:period}),false);
});

test('integration demand writes reject other periods before loading any data',async()=>{
 const old={...process.env};Object.assign(process.env,env,{TV3_WRITE_SCOPE_MODE:'integration-test',TV3_WRITE_PERIOD_ID:'0f38b6da-4552-4885-9c0b-dbb295e8ef8c'});
 const repository={load:()=>assert.fail('No outside-scope read or write')};
 try{const {saveDemand,clearDemand}=require('../dist/services/staffing-demand.service.js');await assert.rejects(saveDemand(period,branch,'actor',{},repository),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');await assert.rejects(clearDemand(period,branch,{},repository),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');}
 finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});

test('integration mode cannot bypass workflow and shift-change guards by disabling scope',async()=>{
 const old={...process.env};Object.assign(process.env,{TV3_WRITE_SCOPE_MODE:'integration-test',TV3_WRITE_SCOPE_ENABLED:'false',TV3_TEST_PREVIEW_ENABLED:'false'});
 try{
  const {requireWorkflowWrites}=require('../dist/services/schedule-workflow.service.js');
  const {requireShiftChangeWriteScope}=require('../dist/services/shift-change-write-scope.js');
  assert.throws(()=>requireWorkflowWrites(),e=>e.code==='WORKFLOW_SCOPE_FORBIDDEN');
  await assert.rejects(requireShiftChangeWriteScope('CREATE_REQUEST',{},branch),e=>e.code==='TV5_SCOPE_FORBIDDEN');
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('both draft writer entry points reject outside scope before database access',async()=>{
 const saved={...process.env};Object.assign(process.env,env,{TV3_DRAFT_PERSISTENCE_ENABLED:'true',TV3_TEST_PREVIEW_ENABLED:'false'});
 try{
  const {persistPreview}=require('../dist/services/draft-persistence.service.js');
  const {createDraft}=require('../dist/services/scheduling.service.js');
  await assert.rejects(persistPreview('other',branch,'actor',{}),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
  await assert.rejects(createDraft('other','actor',branch),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

test('manual scope excludes published periods and cannot be disabled',()=>{const p='7f48f53e-d707-4a32-9f15-eb32aeb0095a',dec='0f38b6da-4552-4885-9c0b-dbb295e8ef8c';const manual={...env,TV3_WRITE_SCOPE_MODE:'manual-test',TV3_WRITE_PERIOD_ID:p};assert.equal(draftWriteScopeAllowed(p,branch,manual),true);for(const id of [period,dec])assert.equal(draftWriteScopeAllowed(id,branch,manual),false);assert.equal(draftWriteScopeAllowed(p,branch,{...manual,TV3_WRITE_SCOPE_ENABLED:'false'}),false);});
