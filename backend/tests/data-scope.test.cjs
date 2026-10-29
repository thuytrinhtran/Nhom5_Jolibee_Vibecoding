const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const { requireEmployeeOwner, requireBranchScope } = require('../dist/middleware/data-scope.middleware.js');
const { supabaseAdmin } = require('../dist/config/supabase.js');
const response = () => ({ code: null, passed: false, status(code) { this.code = code; return this; }, json() {} });
test('ownership and branch guards deny cross-user/cross-branch and pending users', async () => {
  const nv = { role: 'NV', must_change_password: false, employee: { id: 'own' } };
  for (const [user, resource, expected] of [[nv,'own',true],[nv,'other',false],[{...nv,must_change_password:true},'own',false],[undefined,'own',false]]) {
    const res = response(); requireEmployeeOwner(() => resource)({ user },res,() => { res.passed = true; }); assert.equal(res.passed,expected);
  }
  for (const [role, branch, expected] of [['QL','own',true],['QL','other',false],['NV','own',false]]) {
    const res = response(); await requireBranchScope(() => branch)({ user: { role, branch_id: 'own', must_change_password: false } },res,() => { res.passed = true; }); assert.equal(res.passed,expected);
  }
});
test('GS scope comes from branches.supervisor_id; database errors fail closed', async () => {
  const original = supabaseAdmin.from;
  try {
    for (const [data,error,expected] of [[{id:'branch'},null,true],[null,null,false],[null,{code:'offline'},false]]) {
      const filters = [];
      supabaseAdmin.from = table => { assert.equal(table,'branches'); return { select(){return this;},eq(key,value){filters.push([key,value]);return this;},maybeSingle: async()=>({data,error}) }; };
      const res = response(); await requireBranchScope(()=>'branch')({user:{id:'gs',role:'GS',must_change_password:false}},res,()=>{res.passed=true;});
      assert.equal(res.passed,expected); assert.deepEqual(filters,[['id','branch'],['supervisor_id','gs']]); if(error) assert.equal(res.code,503);
    }
  } finally { supabaseAdmin.from = original; }
});
