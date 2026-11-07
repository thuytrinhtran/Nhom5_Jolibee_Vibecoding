const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.DEV_IMPORT_ENABLED='false';process.env.SCHEDULING_DATA_SOURCE='supabase';
test('saved draft reads all assignment pages and audits concurrently without per-employee queries',async()=>{
 const {supabaseAdmin:db}=require('../dist/config/supabase.js'),{readDraft}=require('../dist/services/scheduling.service.js');const original=db.from;
 const rows=Array.from({length:1001},(_,i)=>({id:String(i),employee_id:'e'+i,work_date:'2026-11-02',shift_id:'shift',department_id:'dept',status:'DRAFT'}));
 const calls=[];let auditStarted=false;
 db.from=table=>{let offset=0;calls.push(table);return {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},range(from){offset=from;return this;},maybeSingle:async()=>{if(table==='audit_logs'){auditStarted=true;return {data:null,error:null};}return {data:{id:'schedule',status:'DRAFT'},error:null};},then(resolve){assert.ok(auditStarted,'audit read must start before assignment query finishes');resolve({data:rows.slice(offset,offset+500),error:null});}};};
 try{const result=await readDraft('schedule','branch');assert.equal(result.assignments.length,1001);assert.equal(result.assignments.at(-1).id,'1000');assert.equal(calls.filter(t=>t==='shift_assignments').length,3);assert.equal(calls.filter(t=>t==='audit_logs').length,1);assert.equal(calls.includes('employees'),false);}finally{db.from=original;}
});
