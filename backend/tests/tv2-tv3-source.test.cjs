const {test}=require('node:test'),assert=require('node:assert/strict');
const {tv2Availability,readTv2Source}=require('../dist/registrations/tv3-source.js');
const period={id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08'};
const employee={id:'e',branch_id:'b',status:'ACTIVE',skill_level:'REGULAR',role:'NV',is_active:true};
const header={employee_id:'e',status:'VALID',submitted_at:'stamp',updated_at:'v1',sample_batch_id:null};
const row={id:'r',period_id:'p',employee_id:'e',work_date:'2026-11-02',shift_id:'s',status:'VALID',submitted_at:'stamp'};
test('TV2 handoff rejects missing/draft/sample headers, bad scope/date/shift and duplicate rows',()=>{
 const shifts=[{id:'s',is_active:true,branch_id:'b'}];
 const run=(headers,rows=[row],people=[employee],ca=shifts)=>tv2Availability({headers,rows},period,people,ca);
 for(const headers of [[],[{...header,status:'DRAFT'}],[{...header,submitted_at:null}],[{...header,sample_batch_id:'batch'}]]){const result=run(headers);assert.equal(result.registrations.length,0);assert.ok(result.declarations.every(d=>d.declaration==='NOT_SUBMITTED'));}
 const result=run([header],[row,{...row,id:'duplicate'}, {...row,id:'wrong-period',period_id:'other'},{...row,id:'wrong-date',work_date:'2026-11-09'}]);assert.equal(result.registrations.length,1);assert.equal(result.declarations.filter(d=>d.declaration==='OFF').length,6);
 assert.ok(run([header],[]).declarations.every(d=>d.declaration==='OFF'));
 for(const person of [{...employee,branch_id:'other'},{...employee,status:'INACTIVE'},{...employee,is_active:false},{...employee,role:'QL'},{...employee,skill_level:'CREW_LEADER'}])assert.equal(run([header],[row],[person]).registrations.length,0);
 assert.equal(run([header],[row],[employee],[{id:'s',is_active:true,branch_id:'other'}]).registrations.length,0);
});
test('read handoff detects concurrent resubmission instead of mixing header revisions',async()=>{
 let reads=0;const db={from(table){return{select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:table==='shift_registrations'?[row]:[{...header,updated_at:++reads===1?'v1':'v2'}],error:null})}}}};
 await assert.rejects(readTv2Source(db,'p'),e=>e.code==='REGISTRATION_CHANGED');
});
