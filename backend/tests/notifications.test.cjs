const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
process.env.DEV_IMPORT_ENABLED='false';

test('notification HTTP reader scopes recipients to token, rejects filters and never writes',async()=>{
 const {supabaseAdmin:db}=require('../dist/config/supabase.js');
 const app=require('../dist/server.js').default;
 const original={from:db.from,getUser:db.auth.getUser};
 let actor='first',failure=false,queries=[];
 db.auth.getUser=async()=>({data:{user:{id:actor}},error:null});
 db.from=table=>{
   const filters=[];
   return {
     select(columns){if(table==='notifications')queries.push({columns,filters});return this;},
     eq(key,value){filters.push([key,value]);return this;},
     single:async()=>({data:table==='users'?{id:actor,role:'QL',username:'manager',is_active:true,must_change_password:false,branch_id:'branch'}:{name:'Branch'},error:null}),
     order(key,options){assert.equal(key,'created_at');assert.equal(options.ascending,false);return this;},
     limit:async count=>{assert.equal(count,30);return {data:[{id:'notice',title:'Notice'}],error:failure?{message:'secret database detail'}:null};}
   };
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const get=(suffix='',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/notifications${suffix}`,{headers:auth?{Authorization:'Bearer test'}:{}});
 try{
   assert.equal((await get('',false)).status,401);
   assert.equal((await get('?recipient_id=other')).status,400);
   assert.equal(queries.length,0);
   let response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.deepEqual(queries.at(-1).filters,[['recipient_id','first']]);
   assert.equal(queries.at(-1).columns,'id,type,title,content,created_at');
   actor='second';response=await get();assert.equal(response.status,200);
   assert.deepEqual(queries.at(-1).filters,[['recipient_id','second']]);
   failure=true;response=await get();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret database detail'));
 }finally{db.from=original.from;db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});
