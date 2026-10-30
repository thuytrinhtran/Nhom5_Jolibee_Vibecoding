const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
process.env.SUPABASE_URL='http://127.0.0.1:9';
process.env.SUPABASE_SECRET_KEY='isolated-fixture-not-a-real-key';
const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');

test('competency API: scoped list, four levels, only skill update, persistence, stale and unauthorized writes',async()=>{
 const original={from:db.from,getUser:db.auth.getUser};
 const uid='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
 let role='QL',pending=false,denied=false,writes=0;
 const employee={id,full_name:'Fixture Employee',branch_id:'branch-A',department_id:'dept',skill_level:'NEW',user:{username:'NV_FIXTURE'},branch:{name:'Fixture Branch'},department:{name:'Kitchen'}};
 db.auth.getUser=async()=>({data:{user:{id:uid}},error:null});
 db.from=table=>{const filters=[];let update;const result=()=>{
  if(table==='users')return{data:{id:uid,username:'fixture_manager',role,branch_id:'branch-A',is_active:true,must_change_password:pending},error:null};
  if(table==='branches')return{data:{name:'Fixture Branch'},error:null};
  assert.equal(table,'employees');
  if(update){writes++;assert.deepEqual(Object.keys(update),['skill_level']);assert.ok(filters.some(([k,v])=>k==='id'&&v===id));assert.ok(filters.some(([k,v])=>k==='branch_id'&&v==='branch-A'));
   if(denied)return{data:null,error:{code:'42501'}};
   if(filters.find(([k])=>k==='skill_level')?.[1]!==employee.skill_level)return{data:null,error:null};
   employee.skill_level=update.skill_level;return{data:{id,skill_level:employee.skill_level},error:null};
  }
  if(filters.some(([k])=>k==='id'))return{data:{...employee},error:null};
  if(filters.some(([k])=>k==='user_id'))return{data:{id,full_name:'Fixture'},error:null};
  assert.ok(filters.some(([k,v])=>k==='branch_id'&&v==='branch-A'));return{data:[{...employee}],error:null};
 };return{select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},range(){return this},update(value){update=value;return this},single:async()=>result(),maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/employee-competencies';
 const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 const patch=body=>fetch(base+'/'+id+'/skill-level',{method:'PATCH',headers,body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base)).status,401);
  for(const r of ['NV','GS']){role=r;assert.equal((await fetch(base,{headers})).status,403);assert.equal((await patch({skill_level:'REGULAR'})).status,403);}role='QL';
  pending=true;assert.equal((await patch({skill_level:'REGULAR'})).status,403);pending=false;
  let response=await fetch(base,{headers});assert.equal(response.status,200);assert.equal((await response.json()).employees[0].employee_code,'NV_FIXTURE');
  for(const body of [{skill_level:'TRAINEE'},{skill_level:'REGULAR',role:'GS'},{skill_level:'REGULAR',branch_id:'other'},{}])assert.equal((await patch(body)).status,400);
  assert.equal(writes,0);
  employee.branch_id='other';assert.equal((await patch({skill_level:'REGULAR'})).status,403);assert.equal(writes,0);employee.branch_id='branch-A';
  for(const skill_level of ['REGULAR','CREW_TRAINING','CREW_LEADER','NEW']){response=await patch({skill_level,expected_skill_level:employee.skill_level});assert.equal(response.status,200);assert.equal((await response.json()).employee.skill_level,skill_level);}
  response=await fetch(base,{headers});assert.equal((await response.json()).employees[0].skill_level,'NEW');
  assert.equal(employee.department_id,'dept');assert.equal(employee.branch_id,'branch-A');assert.equal(role,'QL');
  assert.equal((await patch({skill_level:'CREW_TRAINING',expected_skill_level:'REGULAR'})).status,409);assert.equal(employee.skill_level,'NEW');
  denied=true;assert.equal((await patch({skill_level:'REGULAR'})).status,503);assert.equal(employee.skill_level,'NEW');
 }finally{db.from=original.from;db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});
