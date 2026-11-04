const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const ctx={exports:{},Intl,Date,Map,Set,AbortSignal,Error,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,ctx);return ctx.exports;}
const preview=()=>({period:{id:'period'},input_revision:'source',result:{assignments:[{employee_id:'employee',work_date:'2026-10-26',shift_id:'shift',department_id:'dept',reason:'not sent'}]}});
const response=()=>({scope:'preview',persisted:false,input_revision:'source',plan_revision:'plan',configured:true,model:'double',status:'AVAILABLE',message:'Preview evaluated',evaluation:{scope:'preview',contract_version:'tv3-ai.v1',input_revision:'plan',created_at:'now',employee_aliases:[],labels:[],missing_criteria:[],report:{conclusion:'NEEDS_ADJUSTMENT',good_points:['Coverage checked'],concerns:[],limitations:[],suggestions:[]}}});
function buttons(node,out=[]){if(!React.isValidElement(node))return out;if(node.type==='button')out.push(node);React.Children.forEach(node.props.children,c=>buttons(c,out));return out;}
function page(service,{autoEvaluate=false}={}){let value=preview(),dirty=false,tree,si=0,ri=0,ei=0;const states=[],refs=[],effects=[],pending=[];const hooks={...React,useState(initial){const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){return refs[ri++]||={current:initial}},useEffect(callback,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=callback())}}};const mod=load('src/pages/manager/ScheduleAIPanel.tsx',{'react':hooks,'../../services/scheduling.service':{schedulingService:service}});return{async settle(){for(let i=0;i<8;i++){si=ri=ei=0;tree=mod.PreviewScheduleAIPanel({preview:value,dirty,autoEvaluate});while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r))}},get value(){return value},set preview(v){value=v},set dirty(v){dirty=v},get button(){return buttons(tree)[0]},click(){return buttons(tree)[0].props.onClick()},html(){return renderToStaticMarkup(tree)}}}
const config=async()=>({configured:true,model:'double',message:'Ready'});
test('preview evaluation only on explicit click; ephemeral report invalidates after edits',async()=>{let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async v=>{posts++;assert.equal(v.input_revision,'source');return response()}});await p.settle();assert.equal(posts,0);assert.equal(p.button.props.disabled,false);p.click();await p.settle();assert.equal(posts,1);assert.ok(p.html().includes('Coverage checked'));assert.ok(!p.html().includes('schedule_version'));p.dirty=true;await p.settle();assert.ok(p.button.props.disabled);assert.ok(p.html().includes('Coverage checked'));assert.match(p.html(),/Hết hiệu lực/);p.dirty=false;p.preview={...preview(),result:{assignments:[]}};await p.settle();assert.equal(p.button.props.disabled,false);assert.match(p.html(),/Hết hiệu lực/);assert.equal(posts,1)});
test('late response cannot attach report to changed preview',async()=>{let finish;const p=page({previewAIConfiguration:config,evaluatePreviewAI:()=>new Promise(r=>finish=r)});await p.settle();p.click();await p.settle();p.preview={...preview(),input_revision:'new-source'};await p.settle();finish(response());await p.settle();assert.ok(!p.html().includes('Coverage checked'));assert.equal(p.button.props.disabled,false)});
test('provider failures preserve preview and expose error; unconfigured never POSTs',async()=>{const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{throw Error('Provider unavailable')}});await p.settle();p.click();await p.settle();assert.ok(p.html().includes('Provider unavailable'));assert.equal(p.button.props.disabled,false);const off=page({previewAIConfiguration:async()=>({configured:false,model:null,message:'Disabled'}),evaluatePreviewAI:()=>assert.fail('No provider')});await off.settle();assert.ok(off.button.props.disabled);assert.ok(off.html().includes('Disabled'))});
test('preview client sends whitelisted assignment fields; shared wrapper chooses preview and saved separately',async()=>{const calls=[];class ApiError extends Error{}const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'ok',result:response()}))}}).schedulingService;await service.previewAIConfiguration();await service.evaluatePreviewAI(preview());assert.equal(calls[0].options.method,undefined);assert.equal(calls[1].url,'/api/schedules/preview/ai-evaluation');const body=JSON.parse(calls[1].options.body);assert.deepEqual(Object.keys(body).sort(),['assignments','input_revision','period_id']);assert.equal(body.assignments[0].reason,undefined);const mod=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});assert.equal(mod.ScheduleAIPanel({preview:preview()}).type,mod.PreviewScheduleAIPanel);assert.equal(mod.ScheduleAIPanel({saved:{}}).type,mod.SavedScheduleAIPanel)});

test('automatic preview evaluation runs once without saving and re-evaluates the validated edited plan',async()=>{
 let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async value=>{posts++;assert.equal(value.input_revision,'source');return response();},savePreview:()=>assert.fail('No persistence'),evaluateAI:()=>assert.fail('Do not call saved evaluation')},{autoEvaluate:true});
 const original=p.value,before=JSON.stringify(original);await p.settle();await p.settle();assert.equal(posts,1);assert.equal(p.value,original);assert.equal(JSON.stringify(original),before);assert.ok(p.html().includes('Coverage checked'));
 p.dirty=true;await p.settle();assert.ok(p.button.props.disabled);assert.ok(p.html().includes('Hết hiệu lực'));
 p.preview={...preview(),result:{assignments:[]}};p.dirty=false;await p.settle();assert.equal(posts,2);assert.equal(p.button.props.disabled,false);await p.settle();assert.equal(posts,2);
});

test('a new saved edit target triggers fresh automatic review even with identical source and assignments',async()=>{
 let calls=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{calls++;return response();}},{autoEvaluate:true});
 await p.settle();assert.equal(calls,1);
 p.preview={...preview(),edit_target:{id:'new-draft',version:3}};await p.settle();assert.equal(calls,2);
 await p.settle();assert.equal(calls,2);
});

test('automatic failure preserves Rule Engine plan, does not loop and allows explicit retry',async()=>{
 let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{if(++posts===1)throw Error('Provider timeout');return response();}},{autoEvaluate:true});
 const original=p.value;await p.settle();assert.equal(posts,1);assert.ok(p.html().includes('Provider timeout'));assert.equal(p.value,original);await p.settle();assert.equal(posts,1);
 p.click();await p.settle();assert.equal(posts,2);assert.ok(p.html().includes('Coverage checked'));assert.equal(p.value,original);
});

test('slow automatic response is discarded after edit and cannot replace the new plan report',async()=>{
 const completions=[];const p=page({previewAIConfiguration:config,evaluatePreviewAI:()=>new Promise(resolve=>completions.push(resolve))},{autoEvaluate:true});
 await p.settle();assert.equal(completions.length,1);assert.ok(p.html().includes('Phương án Rule Engine vẫn giữ nguyên'));assert.ok(p.button.props.disabled);
 p.dirty=true;await p.settle();p.preview={...preview(),input_revision:'new-source'};p.dirty=false;await p.settle();assert.equal(completions.length,2);
 completions[0](response());await p.settle();assert.ok(!p.html().includes('Coverage checked'));
 const fresh=response();fresh.input_revision='new-source';fresh.plan_revision='new-plan';fresh.evaluation.input_revision='new-plan';fresh.evaluation.report.good_points=['New plan reviewed'];completions[1](fresh);await p.settle();assert.ok(p.html().includes('New plan reviewed'));assert.ok(!p.html().includes('Coverage checked'));
});

test('configuration read failure can retry without discarding preview; disabled provider never posts',async()=>{
 let checks=0,posts=0;const p=page({previewAIConfiguration:async()=>{if(++checks===1)throw Error('Config network unavailable');return config();},evaluatePreviewAI:async()=>{posts++;return response();}},{autoEvaluate:true});
 await p.settle();assert.equal(posts,0);assert.equal(p.button.props.disabled,false);p.click();await p.settle();assert.equal(posts,1);
 const off=page({previewAIConfiguration:async()=>({configured:false,model:null,message:'AI disabled'}),evaluatePreviewAI:()=>assert.fail('No provider calls')},{autoEvaluate:true});await off.settle();assert.ok(off.html().includes('AI disabled'));assert.ok(off.button.props.disabled);
});

test('503 after balancing hides old remarks, retains the new plan and retries only on click',async()=>{
 let posts=0;const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{posts++;if(posts===2)throw Error('Gemini HTTP 503: tạm thời quá tải');return response();}},{autoEvaluate:true});
 await p.settle();assert.ok(p.html().includes('Coverage checked'));
 p.dirty=true;await p.settle();assert.ok(!p.html().includes('Coverage checked'));assert.ok(p.html().includes('Hết hiệu lực'));
 const balanced={...preview(),result:{assignments:[]}};p.preview=balanced;p.dirty=false;await p.settle();
 assert.equal(posts,2);assert.equal(p.value,balanced);assert.ok(p.html().includes('503'));assert.ok(!p.html().includes('Coverage checked'));
 await p.settle();await p.settle();assert.equal(posts,2);p.click();await p.settle();assert.equal(posts,3);assert.equal(p.value,balanced);assert.ok(p.html().includes('Coverage checked'));
});

test('a complete validated report renders overview and every remark in full details',async()=>{
 const result=response();result.evaluation.report.good_points=['Coverage verified','Experience verified','Hours verified'];result.evaluation.report.concerns=['Shortage in S001','Check new staff'];result.evaluation.report.limitations=['Synthetic availability only'];
 result.evaluation.report.suggestions=[{description:'Review staffing at S001',reason:'Declared demand exceeds available staff',candidate_assignments:null,rule_check:{status:'NOT_APPLICABLE',message:'Advisory only',code:null}}];
 const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>result},{autoEvaluate:true});await p.settle();
 for(const text of ['Đã đánh giá phương án đang xem','Xem đầy đủ đánh giá và giới hạn',...result.evaluation.report.good_points,...result.evaluation.report.concerns,...result.evaluation.report.limitations,'Review staffing at S001','Declared demand exceeds available staff'])assert.ok(p.html().includes(text),text);
});

test('Rule Engine totals include existing coverage and sum cell shortages independently of AI',()=>{
 const {RuleEngineCoverage}=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{}});
 const value={...preview(),result:{...preview().result,required_count:9,assigned_count:3,covered_count:8,coverage:[{required_count:5,assigned_count:6,missing_count:0},{required_count:4,assigned_count:2,missing_count:2}]}};
 const before=JSON.stringify(value),html=renderToStaticMarkup(React.createElement(RuleEngineCoverage,{preview:value,dirty:false}));
 for(const pair of [['Nhu cầu',9],['Đã đáp ứng',8],['Còn thiếu',2]])assert.ok(html.includes(`<dt>${pair[0]}</dt><dd>${pair[1]}</dd>`));
 assert.ok(html.includes('không lấy từ nhận xét AI'));assert.equal(JSON.stringify(value),before);
 const dirty=renderToStaticMarkup(React.createElement(RuleEngineCoverage,{preview:value,dirty:true}));assert.ok(dirty.includes('Có thay đổi chưa kiểm tra'));assert.ok(dirty.includes('data-current="false"'));
});

test('deterministic staffing counts remain visible while AI fails and update after validated balancing',async()=>{
 const p=page({previewAIConfiguration:config,evaluatePreviewAI:async()=>{throw Error('Gemini HTTP 503');}},{autoEvaluate:true});
 const plan=(assigned,missing)=>({...preview(),result:{...preview().result,required_count:9,assigned_count:assigned,coverage:[{required_count:9,assigned_count:assigned,missing_count:missing}]}});
 p.preview=plan(8,1);await p.settle();assert.ok(p.html().includes('<dt>Đã đáp ứng</dt><dd>8</dd>'));assert.ok(p.html().includes('<dt>Còn thiếu</dt><dd>1</dd>'));assert.ok(p.html().includes('503'));
 p.dirty=true;await p.settle();assert.ok(p.html().includes('phương án đã kiểm tra gần nhất'));
 p.preview=plan(9,0);p.dirty=false;await p.settle();assert.ok(p.html().includes('<dt>Đã đáp ứng</dt><dd>9</dd>'));assert.ok(p.html().includes('<dt>Còn thiếu</dt><dd>0</dd>'));
});

