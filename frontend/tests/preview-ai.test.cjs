const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const ctx={exports:{},Intl,Date,Map,Set,AbortSignal,Error,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,ctx);return ctx.exports;}
const preview=()=>({period:{id:'period'},input_revision:'source',result:{coverage:[{work_date:'2026-10-26',shift_id:'am',missing_count:2,missing_experienced_count:1},{work_date:'2026-10-26',shift_id:'pm',missing_count:0,missing_experienced_count:1}],shortages:[],assignments:[{employee_id:'employee',work_date:'2026-10-26',shift_id:'shift',department_id:'dept',reason:'not sent'}]}});
const response=()=>({scope:'preview',persisted:false,input_revision:'source',plan_revision:'plan',configured:true,model:'double',status:'AVAILABLE',message:'Preview evaluated',evaluation:{scope:'preview',contract_version:'tv3-ai.v1',input_revision:'plan',created_at:'now',employee_aliases:[],labels:[],missing_criteria:[],report:{conclusion:'NEEDS_ADJUSTMENT',good_points:[],concerns:[],limitations:[],suggestions:[1,2,3,4].map(i=>({description:'Priority '+i,reason:'Review availability',rule_check:{status:'NOT_APPLICABLE'}}))}}});
function buttons(node,out=[]){if(!React.isValidElement(node))return out;if(node.type==='button')out.push(node);React.Children.forEach(node.props.children,c=>buttons(c,out));return out;}
function page(service,{autoEvaluate=false,globals={},onOpenCell}={}){let value=preview(),dirty=false,tree,si=0,ri=0,ei=0;const states=[],refs=[],effects=[],pending=[];const hooks={...React,useState(initial){const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){return refs[ri++]||={current:initial}},useEffect(callback,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=callback())}}};const mod=load('src/pages/manager/ScheduleAIPanel.tsx',{'react':hooks,'../../services/scheduling.service':{schedulingService:service}},globals);return{async settle(){for(let i=0;i<8;i++){si=ri=ei=0;tree=mod.PreviewScheduleAIPanel({preview:value,dirty,autoEvaluate,onOpenCell});while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r))}},get value(){return value},set preview(v){value=v},set dirty(v){dirty=v},get buttons(){return buttons(tree)},get button(){return buttons(tree)[0]},click(){return buttons(tree)[0].props.onClick()},html(){return renderToStaticMarkup(tree)}}}
const config=async()=>({configured:true,model:'double',message:'Ready'});
test('preview client sends whitelisted assignment fields; shared wrapper chooses preview and saved separately',async()=>{const calls=[];class ApiError extends Error{}const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'ok',result:response()}))}}).schedulingService;await service.previewAIConfiguration();await service.evaluatePreviewAI(preview());assert.equal(calls[0].options.method,undefined);assert.equal(calls[1].url,'/api/schedules/preview/ai-evaluation');const body=JSON.parse(calls[1].options.body);assert.deepEqual(Object.keys(body).sort(),['assignments','input_revision','period_id']);assert.equal(body.assignments[0].reason,undefined);const mod=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});assert.equal(mod.ScheduleAIPanel({preview:preview()}).type,mod.PreviewScheduleAIPanel);assert.equal(mod.ScheduleAIPanel({saved:{}}).type,mod.SavedScheduleAIPanel)});


test('Rule Engine statistics render immediately; only explicit clicks call AI and unchanged plan is cached',async()=>{
 let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{posts++;return response();}},{autoEvaluate:true});
 await p.settle();assert.equal(posts,0);assert.match(p.html(),/Tổng vị trí thiếu: <strong>2/);assert.match(p.html(),/Ca cần chú ý: <strong>2/);assert.match(p.html(),/Vị trí thiếu kinh nghiệm: <strong>2/);
 p.click();await p.settle();assert.equal(posts,1);assert.match(p.html(),/Priority 3/);assert.ok(!p.html().includes('Priority 4'));
 p.click();await p.settle();assert.equal(posts,1);
 p.dirty=true;await p.settle();assert.ok(p.button.props.disabled);assert.ok(!p.html().includes('Priority 1'));
 p.preview={...p.value,input_revision:'changed'};p.dirty=false;await p.settle();assert.equal(posts,1);p.click();await p.settle();assert.equal(posts,2);
});
test('late AI response is discarded after changing preview',async()=>{
 let finish;const p=page({previewAIConfiguration:config,evaluatePreviewAI:()=>new Promise(r=>finish=r)});
 await p.settle();p.click();await p.settle();p.preview={...p.value,input_revision:'new-source'};await p.settle();finish(response());await p.settle();assert.ok(!p.html().includes('Priority 1'));assert.equal(p.button.props.disabled,false);
});
test('failed or mismatched AI response preserves engine statistics and permits retry',async()=>{
 for(const result of [()=>{throw Error('Provider unavailable')},()=>({...response(),persisted:true})]){
  const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>result()});const original=JSON.stringify(p.value);
  await p.settle();p.click();await p.settle();assert.match(p.html(),/AI chưa khả dụng|Phản hồi AI chưa đúng định dạng/);assert.match(p.html(),/Tổng vị trí thiếu: <strong>2/);assert.equal(JSON.stringify(p.value),original);assert.equal(p.button.props.disabled,false);assert.ok(!p.html().includes('Priority 1'));
 }
});
test('unconfigured AI never posts; config retry does not implicitly run Gemini',async()=>{
 let checks=0,posts=0;const p=page({previewAIConfiguration:async()=>{if(++checks===1)throw Error('Unavailable');return config()},evaluatePreviewAI:async()=>{posts++;return response()}});
 await p.settle();p.click();await p.settle();assert.equal(posts,0);p.click();await p.settle();assert.equal(posts,1);
 const off=page({previewAIConfiguration:async()=>({configured:false}),evaluatePreviewAI:()=>assert.fail('No provider')});await off.settle();assert.ok(off.button.props.disabled);assert.match(off.html(),/AI chưa được cấu hình hợp lệ/);
});

test('quota, busy provider, timeout, configuration and invalid JSON have distinct safe messages and release loading',async()=>{
 const cases=[['AI_RATE_LIMITED',429,'hạn mức'],['AI_PROVIDER_UNAVAILABLE',503,'đang bận'],['AI_TIMEOUT',504,'quá chậm'],['AI_CONFIGURATION_ERROR',503,'cấu hình'],['AI_INVALID_RESPONSE',502,'đúng định dạng']];
 const seen=new Set();
 for(const [code,status,expected] of cases){
  let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{posts++;throw Object.assign(Error('private-key private-provider-body'),{code,status})}});
  await p.settle();assert.equal(posts,0);p.click();await p.settle();const html=p.html();assert.ok(html.includes(expected));assert.ok(!html.includes('private-'));assert.ok(!html.includes(code));assert.match(html,/Tổng vị trí thiếu: <strong>2/);assert.equal(p.button.props.disabled,code==='AI_RATE_LIMITED');assert.equal(posts,1);seen.add(html.match(/role="alert">([^<]+)/)[1]);
 }
 assert.equal(seen.size,cases.length);
});

test('real client preserves backend error code/status instead of replacing a quota error',async()=>{
 class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code}}
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async()=>new Response(JSON.stringify({status:'error',code:'AI_RATE_LIMITED',message:'Controlled quota message'}),{status:429,headers:{'Retry-After':'120'}})}).schedulingService;
 await assert.rejects(service.evaluatePreviewAI(preview()),e=>e.status===429&&e.code==='AI_RATE_LIMITED'&&e.retryAfterSeconds===120);
});

test('client distinguishes transport timeout from malformed backend JSON',async()=>{
 class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code}}
 for(const [fetch,expected] of [[async()=>{throw Object.assign(Error('private-timeout'),{name:'TimeoutError'})},'AI_TIMEOUT'],[async()=>new Response('private-invalid-json'),'AI_INVALID_RESPONSE']]){
  const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch}).schedulingService;
  await assert.rejects(service.evaluatePreviewAI(preview()),e=>e.code===expected&&!e.message.includes('private-'));
 }
});

test('engine fallback has three dated actionable cells, no invented candidates and no assignment mutation',async()=>{
 const mod=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});
 const value=preview();value.context={shifts:[{id:'am',name:'Sáng'},{id:'pm',name:'Chiều'}],departments:[{id:'d',name:'Bếp'}],requirements:[]};
 value.result.coverage=Array.from({length:4},(_,i)=>({work_date:`2026-11-${String(9+i).padStart(2,'0')}`,shift_id:'am',department_id:'d',missing_count:i===1?0:2,missing_experienced_count:1}));
 value.context.requirements=value.result.coverage.map((r,i)=>({...r,id:String(i),required_count:2}));value.result.assignments=[{...value.result.coverage[1],employee_id:'actual'}];
 const before=JSON.stringify(value),suggestions=mod.ruleSuggestions(value);assert.equal(suggestions.length,3);assert.equal(suggestions[0].date,'09/11/2026');assert.equal(suggestions[0].shift,'Sáng');assert.equal(suggestions[0].department,'Bếp');assert.ok(suggestions[0].action.length<100);assert.equal(suggestions[1].kind,'experience');assert.equal(JSON.stringify(value),before);
 value.result.coverage=[value.result.coverage[1]];assert.equal(mod.ruleSuggestions(value)[0].button,'Xem ca');
 value.context.requirements=[];assert.equal(mod.ruleSuggestions(value)[0].button,null);
});

test('503 and timeout retain useful engine advice and cell action only navigates',async()=>{
 for(const code of ['AI_PROVIDER_UNAVAILABLE','AI_TIMEOUT']){
  let opened;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{throw {code}}},{onOpenCell:key=>opened=key});
  p.preview={...p.value,context:{shifts:[{id:'am',name:'Sáng'}],departments:[{id:'d',name:'Bếp'}],requirements:[{id:'n',work_date:'2026-11-09',shift_id:'am',department_id:'d',required_count:2}]},result:{...p.value.result,coverage:[{work_date:'2026-11-09',shift_id:'am',department_id:'d',missing_count:2}],assignments:[]}};
  const before=JSON.stringify(p.value);await p.settle();p.click();await p.settle();assert.match(p.html(),/09\/11\/2026 · Sáng · Bếp/);assert.match(p.html(),/Thiếu 2 người/);assert.match(p.html(),/Ưu tiên xử lý/);
  p.buttons[1].props.onClick();assert.equal(opened,'2026-11-09/am/d');assert.equal(JSON.stringify(p.value),before);
  p.dirty=true;await p.settle();assert.ok(!p.html().includes('Xem ca'));
 }
});

test('429 disables Gemini until Retry-After expires, keeps fallback and never automatically posts again',async()=>{
 let clock=100000,posts=0;const timers=[];
 class TestDate extends Date{static now(){return clock}}
 const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{posts++;throw {code:'AI_RATE_LIMITED',status:429,retryAfterSeconds:120}}},{globals:{Date:TestDate,setTimeout:(fn,ms)=>{const timer={fn,at:clock+ms};timers.push(timer);return timer},clearTimeout:timer=>timer.cancelled=true}});
 await p.settle();p.click();await p.settle();assert.equal(posts,1);assert.ok(p.button.props.disabled);assert.match(p.html(),/Ưu tiên xử lý/);p.click();await p.settle();assert.equal(posts,1);
 clock+=120000;for(const timer of timers.filter(t=>!t.cancelled&&t.at<=clock))timer.fn();await p.settle();assert.equal(p.button.props.disabled,false);assert.equal(posts,1);
});

test('cards distinguish checked replacement/empty lists and discard evidence from another preview or lookup mode',()=>{
 const {ruleSuggestions}=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});
 const value=preview();const row={id:'n',work_date:'2026-11-09',shift_id:'am',department_id:'d',missing_count:0,missing_experienced_count:1,required_count:1};
 value.result.coverage=[row];value.result.assignments=[{...row,employee_id:'real'}];value.context={requirements:[row],shifts:[],departments:[]};
 assert.equal(ruleSuggestions(value)[0].problem,'Đủ người, thiếu kinh nghiệm');assert.equal(ruleSuggestions(value)[0].candidateLabel,undefined);
 const checked={preview:value,requirementId:'n',replaceIndex:0,count:2,experiencedCount:1};
 assert.equal(ruleSuggestions(value,[checked])[0].candidateLabel,'Có 2 ứng viên thay thế');
 assert.equal(ruleSuggestions(value,[{...checked,count:0,experiencedCount:0}])[0].candidateLabel,'Chưa có người thay cho phân công đã kiểm tra');
 assert.equal(ruleSuggestions({...value},[checked])[0].candidateLabel,undefined);
 assert.equal(ruleSuggestions(value,[{...checked,replaceIndex:undefined}])[0].candidateLabel,undefined);
 value.result.coverage=[{...row,missing_count:1}];
 assert.equal(ruleSuggestions(value,[{...checked,replaceIndex:undefined,count:0}])[0].candidateLabel,'Không có ứng viên hợp lệ');
});

test('Rule Engine totals include existing coverage and sum cell shortages independently of AI',()=>{
 const {RuleEngineCoverage}=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});
 const value={...preview(),result:{...preview().result,required_count:9,assigned_count:3,covered_count:8,coverage:[{required_count:5,assigned_count:6,missing_count:0},{required_count:4,assigned_count:2,missing_count:2}]}};
 const before=JSON.stringify(value),html=renderToStaticMarkup(React.createElement(RuleEngineCoverage,{preview:value,dirty:false}));
 for(const pair of [['Nhu cầu',9],['Đã đáp ứng',8],['Còn thiếu',2]])assert.ok(html.includes(`<dt>${pair[0]}</dt><dd>${pair[1]}</dd>`));
 assert.ok(html.includes('không lấy từ nhận xét AI'));assert.equal(JSON.stringify(value),before);
 const dirty=renderToStaticMarkup(React.createElement(RuleEngineCoverage,{preview:value,dirty:true}));assert.ok(dirty.includes('Có thay đổi chưa kiểm tra'));assert.ok(dirty.includes('data-current="false"'));
});

test('changing saved edit target invalidates cached remarks but waits for an explicit analysis click',async()=>{
 let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{posts++;return response();}});
 await p.settle();p.click();await p.settle();assert.equal(posts,1);assert.ok(p.html().includes('Priority 1'));
 p.preview={...p.value,edit_target:{id:'new-saved-version',version:4}};await p.settle();assert.equal(posts,1);assert.ok(!p.html().includes('Priority 1'));p.click();await p.settle();assert.equal(posts,2);assert.ok(p.html().includes('Priority 1'));
});

