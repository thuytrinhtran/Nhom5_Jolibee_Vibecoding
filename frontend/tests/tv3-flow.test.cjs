const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const source=fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}");const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const ctx={exports:{},Intl,Date,AbortSignal,Error,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,ctx);return ctx.exports;}
const views=load('src/services/scheduling.view.ts');
const period={id:'period',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED',branch_id:'branch',schedules:[]};
const context={source:'mock',can_generate_mock:true,test_rules:{max_shifts_per_day:1},period,requirements:[{id:'need',work_date:'2026-11-02',shift_id:'pm',department_id:'service',required_count:2,required_skill_name:'Phục vụ'}],valid_registration_count:10,
 employees:[{id:'phuc',full_name:'NV08 Phúc',department_id:'service'},{id:'minh',full_name:'NV07 Minh',department_id:'service'}],shifts:[{id:'pm',name:'Chiều',start_time:'13:00:00',end_time:'17:00:00'}],departments:[{id:'service',name:'Phục vụ'}]};
const assignment={id:'saved:0',employee_id:'phuc',work_date:'2026-11-02',shift_id:'pm',department_id:'service',status:'DRAFT',assignment_source:'REGULAR'};
const saved={source:'mock',is_mock:true,demand_changed:false,schedule:{id:'saved',period_id:'period',version:1,status:'DRAFT'},assignments:[assignment],generation_snapshot:{coverage:[{...context.requirements[0],assigned_count:1,missing_count:1,warning:null}],notes:[]}};
function page(hooks){return load('src/pages/manager/ManagerSchedule.tsx',{react:hooks,'react-router-dom':{Link:({children})=>React.createElement('a',{},children),useSearchParams:()=>[new URLSearchParams(),()=>{}]},
 '../../context/AuthContext':{useAuth:()=>({user:{branch_id:'branch',branch_name:'Branch'}})},'../../services/auth.service':{ApiError:Error},'../../services/scheduling.service':{schedulingService:{}},
 '../../services/scheduling.view':views,'./RegistrationSummaryPanel':{RegistrationSummaryPanel:()=>null},'./ScheduleReviewPanel':{ScheduleReviewPanel:()=>null},'./ScheduleAIPanel':{ScheduleAIPanel:()=>React.createElement('p',{},'AI đánh giá và đề xuất lịch làm việc')},'./MockDraftEditor':{MockDraftEditor:()=>React.createElement('p',{},'Mock draft editor')},});}
test('flow mode enables create/regenerate, labels test data, shows employee shortage and truthful AI status',()=>{
 const states=[[period],'period',context,saved,false,false,false,'','',0];let index=0;
 const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{},useRef:()=>({current:0})};const {ManagerSchedule}=page(hooks);
 const html=renderToStaticMarkup(React.createElement(ManagerSchedule));
 for(const text of ['Dữ liệu thử nghiệm','1 ca/ngày','NV08 Phúc','Thiếu 1','Tạo lại lịch dự kiến','AI đánh giá và đề xuất lịch làm việc','Mock draft editor'])assert.ok(html.includes(text),text);
 assert.ok(!/<button[^>]*disabled=""[^>]*>[^<]*Tạo lại lịch dự kiến/.test(html));
});
test('client sends explicit regenerate revision and PATCH only plain assignment fields',async()=>{
 class ApiError extends Error{};const calls=[];
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'test'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'ok',reused:false,result:{schedule:{id:'next',version:2}}}))}}).schedulingService;
 await service.generate('period',{regenerate:true,expected_version:1});await service.editDraft('saved',{expected_version:1,assignments:[{employee_id:'phuc',work_date:'2026-11-02',shift_id:'pm',department_id:'service'}],note:'Manager checked'});
 assert.deepEqual(JSON.parse(calls[0].options.body),{period_id:'period',regenerate:true,expected_version:1});assert.equal(calls[1].url,'/api/schedules/saved/draft-assignments');assert.equal(calls[1].options.method,'PATCH');
});
function editor(service){const states=[],refs=[];let index=0,refIndex=0;const hooks={...React,useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]},useRef(initial){return refs[refIndex++] ||= {current:initial}},useEffect:()=>{}};let received;
 const mod=load('src/pages/manager/MockDraftEditor.tsx',{react:hooks,'../../services/scheduling.service':{schedulingService:service},'../../services/scheduling.view':views});let tree;
 const render=()=>{index=refIndex=0;tree=mod.MockDraftEditor({context,saved,onSaved:value=>{received=value}});return tree};
 const find=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&React.Children.toArray(node.props.children).includes('Kiểm tra và lưu dự kiến thử nghiệm'))return node;for(const c of React.Children.toArray(node.props.children)){const found=find(c);if(found)return found;}return null};
 return{render,save(){find(render()).props.onClick()},get received(){return received},html(){return renderToStaticMarkup(render())}};
}
test('draft editor validates through backend, reads new version, and never forwards DB/source metadata',async()=>{
 let submitted;const next={...saved,schedule:{...saved.schedule,id:'next',version:2}};
 const instance=editor({editDraft:async(id,body)=>{submitted={id,body};return{schedule:next.schedule}},read:async id=>{assert.equal(id,'next');return next}});
 assert.ok(instance.html().includes('Chỉnh sửa lịch dự kiến thử nghiệm'));instance.save();await new Promise(r=>setImmediate(r));
 assert.equal(instance.received.schedule.version,2);assert.equal(submitted.body.expected_version,1);assert.deepEqual(Object.keys(submitted.body.assignments[0]).sort(),['department_id','employee_id','shift_id','work_date']);
});
test('rule rejection is shown and does not pretend the edit was saved',async()=>{
 const instance=editor({editDraft:async()=>{throw Error('Vượt giới hạn một ca/ngày')},read:async()=>assert.fail('no read after failed validation')});
 instance.save();await new Promise(r=>setImmediate(r));assert.equal(instance.received,undefined);assert.ok(instance.html().includes('Vượt giới hạn một ca/ngày'));assert.ok(instance.html().includes('role="alert"'));
});
