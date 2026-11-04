const {test}=require('node:test'),assert=require('node:assert/strict');
test('TV5 resolves assignment/source/invitation scope from storage for every mutation',async()=>{
 const {supabaseAdmin:db}=require('../dist/config/supabase.js'),{requireShiftChangeWriteScope:check}=require('../dist/services/shift-change-write-scope.js');
 const before={...process.env},original=db.from,branch='11111111-1111-1111-1111-111111111111',period='79a979cc-8347-48b5-a411-f03bd8aceb92';let target=period,tables=[];
 Object.assign(process.env,{NODE_ENV:'development',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_PROJECT_REF:'wlbpprpiieonjrqglicv',TV3_WRITE_BRANCH_ID:branch,TV3_WRITE_PERIOD_ID:period,SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co'});
 db.from=table=>{tables.push(table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({error:null,data:table==='schedules'?{period_id:target,branch_id:branch}:table==='shift_assignments'?{schedule_id:'schedule'}:table==='replacement_invitations'?{shift_change_request_id:'request',incident_id:null}:{original_assignment_id:'assignment'}})};return q;};
 try{
  for(const action of ['CREATE_REQUEST','REPORT','INVITE','APPROVE','REJECT','EXPIRE','ACCEPT','DECLINE']){
   const data={assignment_id:'assignment',kind:'REQUEST',source_id:'request',invitation_id:'invitation'};
   target='other-period';await assert.rejects(check(action,data,branch),e=>e.code==='TV5_SCOPE_FORBIDDEN');
   target=period;await check(action,data,branch);await assert.rejects(check(action,data,'other-branch'),e=>e.code==='TV5_SCOPE_FORBIDDEN');
  }
  assert.ok(tables.includes('replacement_invitations'));assert.ok(tables.includes('shift_change_requests'));
 }finally{db.from=original;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
