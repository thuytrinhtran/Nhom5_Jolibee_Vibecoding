const {test}=require('node:test'),assert=require('node:assert/strict');
const {draftWriteScopeAllowed}=require('../dist/services/draft-write-scope.js');
const {DEV_IMPORT_PROJECT:project,DEV_IMPORT_BRANCH:branch,DEV_IMPORT_PERIOD:period}=require('../dist/registrations/dev-import-policy.js');
const env={TV3_WRITE_SCOPE_ENABLED:'true',NODE_ENV:'development',SUPABASE_URL:`https://${project}.supabase.co`,TV3_WRITE_PROJECT_REF:project,TV3_WRITE_BRANCH_ID:branch,TV3_WRITE_PERIOD_ID:period};
test('operator draft scope accepts only the approved project/branch/period',()=>{
 assert.equal(draftWriteScopeAllowed(period,branch,env),true);
 for(const [p,b] of [['other',branch],[period,'other'],[period,undefined]])assert.equal(draftWriteScopeAllowed(p,b,env),false);
 for(const override of [{SUPABASE_URL:'https://other.supabase.co'},{TV3_WRITE_PERIOD_ID:'other'},{TV3_WRITE_BRANCH_ID:'other'},{TV3_WRITE_PROJECT_REF:'other'},{NODE_ENV:'production'},{TV3_WRITE_SCOPE_ENABLED:'yes'}])assert.equal(draftWriteScopeAllowed(period,branch,{...env,...override}),false);
 assert.equal(draftWriteScopeAllowed('other','other',{}),true);
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
