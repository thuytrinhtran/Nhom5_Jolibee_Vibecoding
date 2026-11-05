const {test}=require('node:test'),assert=require('node:assert/strict');
const {GeminiSchedulingAIAdvisor}=require('../dist/services/schedule-ai.gemini.js');
const ok=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({conclusion:'INSUFFICIENT_DATA',good_points:[],concerns:[],limitations:[],suggestions:[]})}]}}]}));
function runtime(){let clock=0;const delays=[],logs=[];return{delays,logs,now:()=>clock,advance:ms=>clock+=ms,wait:async ms=>{delays.push(ms);clock+=ms},random:()=>0,log:e=>logs.push(e)};}
test('503 retries use bounded backoff and the exact same model and body',async()=>{
 for(const status of [503]){
  const r=runtime(),calls=[];
  const ai=new GeminiSchedulingAIAdvisor('private-key','gemini-fixed',async(url,options)=>{calls.push({url,body:options.body});return calls.length<2?new Response(JSON.stringify({error:{status:status===503?'UNAVAILABLE':'RESOURCE_EXHAUSTED',message:'Model high demand private-person'}}),{status}):ok()},r);
  await ai.evaluate({employees:[]});assert.equal(calls.length,2);assert.deepEqual(r.delays,[1000]);assert.ok(calls.every(c=>c.url===calls[0].url&&c.body===calls[0].body));
  const logs=JSON.stringify(r.logs);assert.ok(!logs.includes('private-key'));assert.ok(!logs.includes('private-person'));assert.equal(r.logs[0].diagnostic,status===503?'MODEL_OVERLOADED':'QUOTA_OR_RATE_LIMIT');assert.equal(r.logs.at(-1).recovered,true);
 }
});
test('retry exhaustion stops at two calls; permanent failures never retry',async()=>{
 for(const status of [503,429,400,401,403,404,500]){
  const r=runtime();let calls=0;
  await assert.rejects(new GeminiSchedulingAIAdvisor('key','gemini-fixed',async()=>{calls++;return new Response('private body',{status})},r).evaluate({}),e=>e.code===({429:'AI_RATE_LIMITED',400:'AI_REQUEST_REJECTED',401:'AI_CONFIGURATION_ERROR',403:'AI_CONFIGURATION_ERROR',404:'AI_CONFIGURATION_ERROR'}[status]??'AI_PROVIDER_UNAVAILABLE')&&!e.message.includes('private body'));
  assert.equal(calls,status===503?2:1);assert.equal(r.delays.length,calls-1);assert.equal(r.logs.at(-1).retry,false);
 }
});
test('429 never retries immediately; Retry-After sets cooldown across adapter instances and expires',async()=>{
 for(const after of ['4','120','invalid',new Date(120000).toUTCString()]){
  const r=runtime();let calls=0;
  const send=async()=>{calls++;return calls===1?new Response('{}',{status:429,headers:{'Retry-After':after}}):ok()};
  const expected=after==='4'?4:after==='invalid'?60:120;
  const ai=()=>new GeminiSchedulingAIAdvisor('key','gemini-cooldown',send,r);
  await assert.rejects(ai().evaluate({}),e=>e.code==='AI_RATE_LIMITED'&&e.retryAfterSeconds===expected);
  assert.equal(calls,1);assert.deepEqual(r.delays,[]);
  r.advance((expected-1)*1000);await assert.rejects(ai().evaluate({}),e=>e.retryAfterSeconds===1);assert.equal(calls,1);
  r.advance(1000);await ai().evaluate({});assert.equal(calls,2);
 }
});
test('network failures and malformed successful responses do not enter the retry loop',async()=>{
 for(const send of [async()=>{throw new TypeError('private-network')},async()=>new Response('invalid-json')]){
  const r=runtime();let calls=0;
  await assert.rejects(new GeminiSchedulingAIAdvisor('key','gemini-fixed',async(...args)=>{calls++;return send(...args)},r).evaluate({}));assert.equal(calls,1);assert.equal(r.delays.length,0);
 }
});

test('every attempt shares a ten-second abort signal including response streaming',async()=>{
 const r=runtime(),signals=[];let calls=0;
 await new GeminiSchedulingAIAdvisor('key','gemini-fixed',async(_url,options)=>{signals.push(options.signal);return ++calls===1?new Response('{}',{status:503}):ok()},r).evaluate({});
 assert.equal(calls,2);assert.equal(signals[0],signals[1]);assert.equal(signals[0].aborted,false);
});

test('ten-second deadline also bounds stalled transport and response body',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const send of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]){
  const request=new GeminiSchedulingAIAdvisor('key','gemini-fixed',send,runtime()).evaluate({});
  const rejected=assert.rejects(request,e=>e.code==='AI_TIMEOUT'&&e.status===504);
  await Promise.resolve();t.mock.timers.tick(10000);await rejected;
 }
});
