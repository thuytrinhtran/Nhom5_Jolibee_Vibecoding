const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
process.env.NODE_ENV='test';
// Transport-only test: no Supabase client calls or authentication secrets.
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='isolated-test-placeholder';
const service=require('../dist/services/schedule-workflow.service.js');
const original=service.transitionSchedule;
const auth=require('../dist/middleware/auth.middleware.js');
const originalAuth=auth.authenticate;
auth.authenticate=(req,res,next)=>next();
const router=require('../dist/routes/schedule-workflow.routes.js').default;
auth.authenticate=originalAuth;

test('TV4 submit HTTP response satisfies the shared editor success envelope and preserves errors',async()=>{
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:'qa',role:'QL',branch_id:'branch',must_change_password:false};next();});
 app.use(router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const id='00000000-0000-4000-8000-000000000001';
 const post=()=>fetch(`http://127.0.0.1:${server.address().port}/${id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version:1})});
 try{
  service.transitionSchedule=async()=>({schedule:{id,version:1,status:'PENDING_APPROVAL'},reused:false});
  const response=await post(),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.status,'ok');
  assert.equal(data.schedule.status,'PENDING_APPROVAL');assert.equal(data.schedule.id,id);assert.equal(data.reused,false);
  const {ScheduleError}=require('../dist/services/scheduling.engine.js');
  for(const [status,code] of [[503,'WORKFLOW_PERSISTENCE_DISABLED'],[403,'WORKFLOW_SCOPE_FORBIDDEN'],[409,'COVERAGE_INCOMPLETE']]){
   service.transitionSchedule=async()=>{throw new ScheduleError(status,code,'Submission blocked');};
   const blocked=await post(),error=await blocked.json();
   assert.equal(blocked.status,status);assert.equal(error.code,code);assert.equal(error.message,'Submission blocked');assert.notEqual(error.status,'ok');
  }
 }finally{service.transitionSchedule=original;await new Promise(resolve=>server.close(resolve));}
});
