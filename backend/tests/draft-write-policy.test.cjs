const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {createDraft}=require('../dist/services/scheduling.service.js');
const {persistPreview}=require('../dist/services/draft-persistence.service.js');
const {createMockDraft,editMockDraft}=require('../dist/services/mock-scheduling.service.js');
const {isDraftPersistenceEnabled}=require('../dist/services/draft-write-policy.js');
const id='00000000-0000-4000-8000-000000000001';
const input={period:{id,branch_id:id,work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees:[],shifts:[{id,start_time:'08:00:00',end_time:'12:00:00',is_active:true}],registrations:[],requirements:[{id,department_id:id,work_date:'2026-11-02',shift_id:id,required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};
test('default/false/invalid flags block every legacy, new and mock writer before storage access',async()=>{
 const original={flag:process.env.TV3_DRAFT_PERSISTENCE_ENABLED,from:db.from,rpc:db.rpc};
 db.from=()=>assert.fail('disabled writer must not read business storage');db.rpc=()=>assert.fail('disabled writer must not call any RPC');
 try{for(const flag of [undefined,'false','','TRUE','1',' true ']){
  if(flag===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=flag;
  assert.equal(isDraftPersistenceEnabled(),false);
  for(const operation of [()=>createDraft(id,id,id),()=>persistPreview(id,id,id,{}),()=>persistPreview(id,id,id,{},id),()=>createMockDraft(id,id,id),()=>editMockDraft(id,id,id,{})])await assert.rejects(operation(),e=>e.status===503&&e.code==='DRAFT_PERSISTENCE_DISABLED');
 }}finally{db.from=original.from;db.rpc=original.rpc;if(original.flag===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=original.flag;}
});
test('HTTP gate covers generate, drafts and draft edits; preview still works when writes are disabled',async()=>{
 const app=require('../dist/server.js').default,repositories=require('../dist/repositories/registration-summary.repository.js');
 const original={flag:process.env.TV3_DRAFT_PERSISTENCE_ENABLED,from:db.from,rpc:db.rpc,getUser:db.auth.getUser,repository:repositories.registrationSummaryRepository};
 process.env.TV3_DRAFT_PERSISTENCE_ENABLED='false';db.rpc=()=>assert.fail('no RPC');db.auth.getUser=async()=>({data:{user:{id}}});
 db.from=table=>{assert.ok(['users','branches'].includes(table));return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id,role:'QL',branch_id:id,is_active:true,must_change_password:false}:{name:'Branch'}})}};
 repositories.registrationSummaryRepository=()=>({source:'supabase',load:async()=>({...input,source:'supabase',branch:{id,name:'Branch'},departments:[],employees:[],new_employee_count_threshold:null})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const call=(path,method='POST')=>fetch(base+path,{method,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({period_id:id,assignments:[],expected_version:1})});
 try{for(const [path,method] of [['/generate','POST'],['/drafts','POST'],[`/${id}/draft-assignments`,'PATCH']]){const r=await call(path,method);assert.equal(r.status,503);assert.equal((await r.json()).code,'DRAFT_PERSISTENCE_DISABLED');}
 const r=await fetch(base+'/preview',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({period_id:id})});assert.equal(r.status,200);assert.equal((await r.json()).result.persistence.enabled,false);
 }finally{db.from=original.from;db.rpc=original.rpc;db.auth.getUser=original.getUser;repositories.registrationSummaryRepository=original.repository;if(original.flag===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=original.flag;await new Promise(r=>server.close(r));}
});
test('legacy service rechecks switch after read/compute and before save',async()=>{
 const original={flag:process.env.TV3_DRAFT_PERSISTENCE_ENABLED,rpc:db.rpc};process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';let reads=0;
 db.rpc=async(_name,args)=>{assert.equal(args.p_result,undefined);reads++;process.env.TV3_DRAFT_PERSISTENCE_ENABLED='false';return{data:{input}}};
 try{await assert.rejects(createDraft(id,id,id),e=>e.code==='DRAFT_PERSISTENCE_DISABLED');assert.equal(reads,1);}finally{db.rpc=original.rpc;if(original.flag===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=original.flag;}
});
