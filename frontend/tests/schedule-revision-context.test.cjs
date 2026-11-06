const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,deps={},globals={}){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},Date,Intl,AbortSignal,Error,...globals,require(id){if(id==='../../components/Toast')return require('./helpers/ui-components.cjs');if(id in deps)return deps[id];if(id.endsWith('.css'))return{};if(id==='react'||id==='react/jsx-runtime')return (id==='../../components/Toast'?require('./helpers/ui-components.cjs'):require(id));return{};}};
 vm.runInNewContext(code,box);return box.exports;
}
const record=(id,version,status,patch={})=>({id,version,status,period_id:'period',branch_id:'branch',schedule_group_id:'group',approvals:[],...patch});
const rejected=record('old',2,'NEEDS_REVISION',{approvals:[{decision:'NEEDS_REVISION',reason:'Bổ sung người có kinh nghiệm\nKiểm tra ca tối',decided_at:'2026-11-04T10:00:00Z'}]});
const draft=record('new',3,'DRAFT');
const views={statusLabel:s=>({DRAFT:'Bản nháp',NEEDS_REVISION:'Cần điều chỉnh'}[s]??s)};
const moduleWith=deps=>load('src/pages/manager/ManagerSchedule.tsx',{'../../services/scheduling.view':views,...deps});
test('revision context selects exact period, branch, group and latest rejection without mutating history',()=>{
 const {revisionDetails}=moduleWith({}),records=[draft,rejected,record('foreign',99,'NEEDS_REVISION',{schedule_group_id:'other'}),record('earlier',1,'DRAFT')],before=JSON.stringify(records);
 const result=revisionDetails(records,'new','period','branch');
 assert.equal(result.previous.id,'old');assert.equal(result.rejected.id,'old');assert.ok(result.decision.reason.includes('Kiểm tra ca tối'));
 assert.equal(revisionDetails(records,'new','another-period','branch'),null);
 assert.equal(revisionDetails(records,'new','period','another-branch'),null);
 assert.equal(JSON.stringify(records),before);
});
function panel(api,initial={schedule:rejected,source:'supabase'}){
 const states=[],effects=[];let index=0,effectIndex=0,tree,saved=initial,periodId='period';
 const hooks={...React,useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useEffect(fn,deps){const i=effectIndex++,old=effects[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){old?.cleanup?.();effects[i]={deps,fn};}}};
 const {ScheduleRevisionContext}=moduleWith({react:hooks,'../../services/scheduling.service':{schedulingService:{revisionHistory:api}}});
 const render=()=>{index=0;effectIndex=0;tree=ScheduleRevisionContext({saved,periodId,branchId:'branch',preview:null});return tree;};
 const walk=(node,out=[])=>{if(!node||typeof node!=='object')return out;if(node.type==='button')out.push(node);for(const child of [node.props?.children].flat(Infinity))walk(child,out);return out;};
 return{render,html:()=>renderToStaticMarkup(render()),set saved(v){saved=v;},set period(v){periodId=v;},retry(){walk(render())[0].props.onClick();},async settle(){render();for(const e of effects)if(e.fn){const fn=e.fn;e.fn=null;e.cleanup=fn();}await new Promise(r=>setImmediate(r));render();}};
}
test('editor retains rejection reason after new DRAFT is saved and shows both server versions',async()=>{
 const p=panel(async()=>[draft,rejected]);await p.settle();
 assert.ok(p.html().includes('Giám sát yêu cầu chỉnh sửa'));assert.ok(p.html().includes('Bổ sung người có kinh nghiệm'));
 p.saved={schedule:draft,source:'supabase'};
 assert.ok(!p.html().includes('Bổ sung người có kinh nghiệm'),'old response is hidden until new version is loaded');
 await p.settle();const html=p.html();
 for(const value of ['DRAFT phiên bản 3','Phiên bản trước: 2','Yêu cầu chỉnh sửa phiên bản 2','Kiểm tra ca tối','Gửi giám sát duyệt lại'])assert.ok(html.includes(value),value);
});
test('late history from another period cannot leak into the selected editor',async()=>{
 let resolve;const p=panel(()=>new Promise(r=>resolve=r));await p.settle();const previous=resolve;
 p.period='another-period';p.saved={source:'supabase',schedule:record('another',1,'DRAFT',{period_id:'another-period'})};await p.settle();
 previous([rejected]);await new Promise(r=>setImmediate(r));
 assert.ok(!p.html().includes('Bổ sung người có kinh nghiệm'));
 resolve([]);await p.settle();assert.ok(p.html().includes('API chưa trả thông tin'));
});
test('missing reason is explicit and failed history can retry without blocking editing',async()=>{
 let calls=0;const p=panel(async()=>{if(++calls===1)throw Error('Offline history');return[{...rejected,approvals:[]}];});await p.settle();
 assert.ok(p.html().includes('Offline history'));p.retry();await p.settle();
 assert.equal(calls,2);assert.ok(p.html().includes('API chưa trả lý do yêu cầu chỉnh sửa.'));
 assert.ok(!p.html().includes('Offline history'));
});
test('revision history client accepts existing TV4 envelope and only performs authenticated GET',async()=>{
 const calls=[];class ApiError extends Error{}
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({schedules:[rejected,draft]}));}}).schedulingService;
 const rows=await service.revisionHistory();assert.equal(rows.length,2);
 assert.equal(calls[0].url,'/api/schedules/workflow?view=publishable');assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.body,undefined);assert.equal(calls[0].options.headers.Authorization,'Bearer fixture');
});

test('manager workflow exposes rejection reason and links back to its exact period',()=>{
 for(const reason of ['Bổ sung ca tối',null]){
  const schedule={...rejected,period_id:'week/with space',is_latest:true,branches:{name:'Chi nhánh'},registration_periods:{work_start_date:'2026-11-02',work_end_date:'2026-11-08'},shift_assignments:[],approvals:[{...rejected.approvals[0],reason,users:{username:'GS'}}]};
  const states=[[schedule],schedule.id,null,'','',{},'',false,false,'','',null,'','','','',0];let n=0;
  const hooks={...React,useEffect(){},useState(initial){const i=n++;return[i<states.length?states[i]:typeof initial==='function'?initial():initial,()=>{}];}};
  const {ScheduleWorkflow}=load('src/pages/schedules/ScheduleWorkflow.tsx',{react:hooks,'../../context/AuthContext':{useAuth:()=>({user:{id:'manager',role:'QL',branch_id:'branch'}})}});
  const html=renderToStaticMarkup(React.createElement(ScheduleWorkflow,{mode:'publish',service:{mode:'api'}}));
  assert.ok(html.includes('Giám sát yêu cầu chỉnh sửa'));assert.ok(html.includes('Phiên bản 2'));
  assert.ok(html.includes(reason??'API chưa trả lý do yêu cầu chỉnh sửa.'));
  assert.ok(html.includes('/manager/schedule?period_id=week%2Fwith%20space'));
 }
});
