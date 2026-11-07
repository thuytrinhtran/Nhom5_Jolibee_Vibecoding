const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={exports:{},Error,Intl,Date,AbortSignal,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,context);return context.exports;
}
const saved={schedule:{id:'saved',version:7,status:'DRAFT'},assignments:[],generation_snapshot:null};
const validation={schedule_id:'saved',version:7,source_state:'CURRENT',hard_constraints:'PASS',data_complete:true,input_current:true,coverage_complete:false,can_submit:true,issues:[],warnings:[{code:'STAFFING_SHORTAGE',message:'Thiếu 30 lượt'}],coverage:[{required_count:168,assigned_count:138,missing_count:30}]};
const handoff={validation,current_status:'DRAFT',target_status:'PENDING_APPROVAL',delivery:{configured:true,sent:false,message:'Not yet sent'}};
const tick=()=>new Promise(setImmediate);
function panel(service,confirm=()=>true,initial=saved){
 const states=[],refs=[];let i=0,r=0,notified=0;
 const hooks={...React,useState(initial){const n=i++;if(!(n in states))states[n]=initial;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v]},useRef(initial){return refs[r++]||={current:initial}},useEffect:()=>{}};
 const {ScheduleReviewPanel}=load('src/pages/manager/ScheduleReviewPanel.tsx',{react:hooks,'../../services/scheduling.service':{schedulingService:service}},{window:{confirm},crypto:require('node:crypto').webcrypto});
 const render=()=>{i=r=0;return ScheduleReviewPanel({saved:initial,onSubmitted:()=>notified++})};
 const walk=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(walk)];
 return{render,html:()=>renderToStaticMarkup(render()),button:()=>walk(render()).find(n=>n.type==='button'),click(){this.button().props.onClick()},get notified(){return notified}};
}

test('saved draft exposes one send action, no auto preparation, rejection claim or prerequisite buttons',()=>{
 const p=panel({prepareHandoff:()=>assert.fail('No auto prepare'),submitApproval:()=>assert.fail('No auto submit')});
 const html=p.html();assert.equal((html.match(/<button/g)||[]).length,1);assert.ok(html.includes('Gửi giám sát phê duyệt'));assert.ok(!html.includes('Lịch bị từ chối'));assert.ok(!html.includes('Chuẩn bị dữ liệu'));assert.equal(p.button().props.disabled,undefined);
});

test('one click prepares latest saved ID/version, confirms 30 missing and submits without saving another draft',async()=>{
 const calls=[];let message='';
 const p=panel({prepareHandoff:async(...a)=>{calls.push(['prepare',...a]);return handoff},submitApproval:async(...a)=>{calls.push(['submit',...a]);},savePreview:()=>assert.fail('Must not save'),generate:()=>assert.fail('Must not regenerate')},text=>{message=text;return true});
 p.click();await tick();assert.deepEqual(calls.map(c=>c[0]),['prepare','submit']);for(const c of calls){assert.equal(c[1],'saved');assert.equal(c[2],7)}assert.match(message,/138\/168/);assert.match(message,/thiếu 30/);assert.equal(p.notified,1);assert.equal(p.button().props.disabled,true);assert.ok(p.html().includes('Đã gửi'));
});

test('cancelling confirmation leaves draft unchanged and next click rechecks source',async()=>{
 let prepared=0;const p=panel({prepareHandoff:async()=>{prepared++;return handoff},submitApproval:()=>assert.fail('Cancelled')},()=>false);
 p.click();await tick();p.click();await tick();assert.equal(prepared,2);assert.equal(p.notified,0);
});

for(const condition of ['UNKNOWN','CHANGED','hard','version','scope','incomplete'])test(`send blocks ${condition} even if can_submit is incorrectly true`,async()=>{
 const v={...validation,...(['UNKNOWN','CHANGED'].includes(condition)?{source_state:condition}:{}),...(condition==='hard'?{hard_constraints:'FAIL'}:{}),...(condition==='version'?{version:6}:{}),...(condition==='incomplete'?{data_complete:false}:{})};
 const p=panel({prepareHandoff:async()=>({...handoff,validation:v,delivery:{...handoff.delivery,configured:condition!=='scope'}}),submitApproval:()=>assert.fail('Must block')},()=>assert.fail('No confirmation for invalid input'));
 p.click();await tick();assert.ok(p.html().includes('role="alert"'));assert.equal(p.notified,0);
});

test('retry uses original confirmed request even when first response was lost after server changed status',async()=>{
 const calls=[];let prepared=0,confirmed=0;
 const p=panel({prepareHandoff:async()=>{prepared++;if(prepared>1)throw Error('Already pending');return handoff},submitApproval:async(...a)=>{calls.push(a);if(calls.length===1)throw Error('Lost response')}},()=>{confirmed++;return true});
 p.click();await tick();assert.ok(p.html().includes('Lost response'));p.click();await tick();assert.equal(calls[0][3],calls[1][3]);assert.equal(prepared,1);assert.equal(confirmed,1);assert.equal(p.notified,1);
});

test('preparation errors remain visible and non-DRAFT cannot send',async()=>{
 const p=panel({prepareHandoff:async()=>{throw Error('Source unavailable')}});p.click();await tick();assert.ok(p.html().includes('Source unavailable'));
 const pending=panel({prepareHandoff:()=>assert.fail('Not DRAFT')},()=>true,{...saved,schedule:{...saved.schedule,status:'PENDING_APPROVAL'}});assert.equal(pending.button().props.disabled,true);pending.click();await tick();
});

test('real client accepts TV4 submit envelope and rejects wrong ID/version/state without weakening TV3 validation',async()=>{
 class ApiError extends Error{};let payload={schedule:{id:'saved',version:7,status:'PENDING_APPROVAL'},reused:false};const calls=[];
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(payload))}}).schedulingService;
 for(const reused of [false,true]){payload.reused=reused;assert.equal((await service.submitApproval('saved',7,'note','request')).reused,reused)}
 assert.equal(calls[0].url,'/api/schedules/workflow/saved/submit');assert.deepEqual(JSON.parse(calls[0].options.body),{expected_version:7,note:'note',request_id:'request'});
 for(const schedule of [{id:'other',version:7,status:'PENDING_APPROVAL'},{id:'saved',version:6,status:'PENDING_APPROVAL'},{id:'saved',version:7,status:'DRAFT'}]){payload={schedule,reused:false};await assert.rejects(service.submitApproval('saved',7,'','id'))}
 await assert.rejects(service.preview('period'),'TV3 still requires its own envelope');
});
