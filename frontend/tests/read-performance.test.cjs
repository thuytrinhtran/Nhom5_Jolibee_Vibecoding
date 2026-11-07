const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
function load(file,dependencies={},globals={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports:{},Response,AbortSignal,Error,...globals,require:id=>{if(id in dependencies)return dependencies[id];return{}}};vm.runInNewContext(code,context);return context.exports;}
test('read-only scheduling POSTs coalesce identical work and do not invalidate data; mutations still do',async()=>{
 const pending=[],events=[];let calls=0;
 const service=load('src/services/auth.service.ts',{}, {localStorage:{getItem:()=> 'fixture'},Event:class{constructor(type){this.type=type}},window:{dispatchEvent:e=>events.push(e.type)},fetch:()=>{calls++;return new Promise(resolve=>pending.push(resolve));}});
 const a=service.fetchWithReadDedupe('/api/schedules/preview',{method:'POST',body:'{"plan":1}'}),b=service.fetchWithReadDedupe('/api/schedules/preview',{method:'POST',body:'{"plan":1}'}),c=service.fetchWithReadDedupe('/api/schedules/preview',{method:'POST',body:'{"plan":2}'});
 assert.equal(calls,2);pending.splice(0).forEach(r=>r(new Response('{}')));await Promise.all([a,b,c]);assert.equal(service.readRequestEpoch(),0);assert.deepEqual(events,[]);
 const writing=service.fetchWithReadDedupe('/api/schedules/workflow/id/submit',{method:'POST',body:'{}'});assert.equal(service.readRequestEpoch(),1);pending.shift()(new Response('{}'));await writing;assert.equal(service.readRequestEpoch(),2);assert.deepEqual(events,['jollishift:data-changed']);
});
test('AI configuration is reused within a token/30s window; token changes and errors never reuse another session',async()=>{
 let token='one',time=1000,calls=0,fail=false;
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError:Error,authService:{getMe:async()=>{},getStoredToken:()=>token}}},{Date:{now:()=>time},fetch:async()=>{calls++;if(fail)throw Error('offline');return new Response(JSON.stringify({status:'ok',result:{external_enabled:false}}));}}).schedulingService;
 await Promise.all([service.previewAIConfiguration(),service.previewAIConfiguration()]);assert.equal(calls,1);time+=30001;await service.previewAIConfiguration();assert.equal(calls,2);token='two';await service.previewAIConfiguration();assert.equal(calls,3);token='three';fail=true;await assert.rejects(service.previewAIConfiguration());fail=false;await service.previewAIConfiguration();assert.equal(calls,5);
});
