const {test}=require('node:test'),assert=require('node:assert/strict');
const {executeTv5LocalRpc}=require('../dist/services/tv5-local-rpc.js');
test('TV5 transport retains SQL validation and 8s budget, uses local planner settings and parameters',async()=>{
 const calls=[],c={query:async(sql,args)=>{calls.push({sql,args});return{rows:[{result:{ok:true}}]};}};
 const value=await executeTv5LocalRpc(c,'tv5_candidates_for_actor',{p_actor_id:'owner',p_assignment_id:'assignment'},{'x-jollishift-dev-import':'context'});
 assert.equal(value.ok,true);assert.equal(calls[0].sql,'BEGIN READ ONLY');assert.ok(calls[1].sql.includes("statement_timeout='8s'"));assert.ok(calls[1].sql.includes('enable_nestloop=off'));assert.deepEqual(calls[3].args,['owner','assignment']);assert.equal(calls.at(-1).sql,'COMMIT');
 calls.length=0;await assert.rejects(executeTv5LocalRpc(c,'unapproved',{},{}),/TV5_RPC_NOT_ALLOWED/);assert.equal(calls.length,0);
});
test('TV5 transaction rolls back on a SQL constraint/ownership failure',async()=>{
 const calls=[],c={query:async(sql)=>{calls.push(sql);if(sql.startsWith('SELECT public.tv5_mutate'))throw Object.assign(Error('FORBIDDEN'),{code:'42501'});return{rows:[]};}};
 await assert.rejects(executeTv5LocalRpc(c,'tv5_mutate',{p_actor_id:'owner',p_action:'APPROVE',p_request_id:'request',p_data:{}},{}),/FORBIDDEN/);
 assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));
});
