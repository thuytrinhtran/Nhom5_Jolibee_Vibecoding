const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(path,overrides={},globals={}){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const ctx={exports:{},Intl,Date,Map,Set,Error,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,ctx);return ctx.exports;}
const view=load('src/services/staffing-demand.view.ts'),grid=load('src/services/staffing-demand.grid.ts',{'./staffing-demand.view':view});
function fixture(){return {period:{id:'week',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},branch:{id:'branch'},is_mock:true,source:'mock',shifts:[['a','08:00','12:00'],['b','12:00','17:00'],['c','17:00','22:00']].map(([id,start_time,end_time],i)=>({id,name:`Ca ${i+1}`,start_time,end_time,is_active:true})),departments:[{id:'k',name:'Bếp'},{id:'t',name:'Thu ngân'},{id:'p',name:'Phục vụ'}],requirements:[{id:'saved',work_date:'2026-11-02',shift_id:'a',department_id:'k',required_count:2,required_skill_name:'Bếp nóng',sales_forecast_ref:'Forecast source',updated_at:'2026-10-29T00:00:00Z',created_by:'actor'}],summary:{rows:[],warnings:[]},skill_names:[]};}
const key=c=>view.demandRowKey(c),value=(count,forecast='')=>({count,forecast});
function nodes(node,predicate,result=[]){if(!React.isValidElement(node))return result;if(predicate(node))result.push(node);React.Children.forEach(node.props.children,c=>nodes(c,predicate,result));return result;}
function workspace(data=fixture()){
 let draft={},errors={},states=[],index=0,tree,allow=true,prompts=0,focused='';
 const hooks={...React,useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]}};
 const mod=load('src/pages/manager/ManagerDemand.tsx',{'react':hooks,'react-router-dom':{Link:'a'},'../../context/AuthContext':{},'../../services/scheduling.service':{},'../../services/scheduling.view':load('src/services/scheduling.view.ts'),'../../services/staffing-demand.view':view,'../../services/staffing-demand.grid':grid,'../../services/staffing-demand.guard':{},'./StaffingStatusMatrix':{StaffingStatusMatrix:()=>null}},{window:{confirm(){prompts++;return allow}},document:{getElementById(id){return{focus(){focused=id}}}}});
 return{render(){index=0;tree=mod.DemandWorkspace({data,draft,onChange:v=>draft=v,saving:false,errors});return tree;},inputs(){return nodes(tree,n=>!!n.props['data-demand-cell'])},find(predicate){return nodes(tree,predicate)},set allow(v){allow=v},get draft(){return draft},get prompts(){return prompts},get focused(){return focused},setErrors(v){errors=v}};
}
test('63 accessible uniform inputs, seven day groups, weekend highlighting, dynamic shift IDs and times',()=>{
 const page=workspace();const html=renderToStaticMarkup(page.render());assert.equal(page.inputs().length,63);assert.equal(page.find(n=>n.type==='tbody').length,7);assert.equal(page.find(n=>n.type==='tbody'&&n.props.className==='demand-weekend').length,2);assert.equal(page.find(n=>n.type==='tr').length-1,21);assert.ok(html.includes('21 ca / tuần'));
 assert.equal(page.find(n=>n.props.rowSpan===3).length,7);assert.ok(html.includes('12:00–17:00'));assert.ok(html.includes('17:00–22:00'));assert.ok(!html.includes('required=""'));assert.equal(page.inputs()[0].props.inputMode,'numeric');assert.equal(page.inputs()[0].props.value,'2');assert.equal(page.inputs()[1].props.value,'');
 assert.equal(page.find(n=>n.type==='details'&&n.props.open).length,0);
});
test('typing is local, Tab retains natural order, Enter/Shift+Enter move in the same column; day filter keeps all edits',()=>{
 const page=workspace();page.render();const input=page.inputs()[1];input.props.onChange({target:{value:'0'}});assert.equal(page.draft['2026-11-02/a/t'].count,'0');assert.equal(input.props.tabIndex,undefined);
 let prevented=false;input.props.onKeyDown({key:'Tab',preventDefault(){prevented=true}});assert.equal(prevented,false);
 input.props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(page.focused,'demand-cell-2026-11-02/b/t');
 page.inputs()[4].props.onKeyDown({key:'Enter',shiftKey:true,preventDefault(){}});assert.equal(page.focused,'demand-cell-2026-11-02/a/t');
 page.find(n=>n.props.id==='demand-day-filter')[0].props.onChange({target:{value:'2026-11-03'}});page.render();assert.equal(page.inputs().length,9);assert.equal(page.draft['2026-11-02/a/t'].count,'0');
});
test('copy Monday, previous day and Excel paste confirm saved overwrites; cancellation changes nothing',()=>{
 const data=fixture();data.requirements.push({...data.requirements[0],id:'tuesday',work_date:'2026-11-03',required_count:9});
 const page=workspace(data);page.render();const copy=page.find(n=>n.type==='button')[0];page.allow=false;copy.props.onClick();assert.equal(Object.keys(page.draft).length,0);assert.equal(page.prompts,1);
 page.allow=true;copy.props.onClick();assert.equal(page.draft['2026-11-03/a/k'].count,'2');assert.equal(page.draft['2026-11-03/a/k'].forecast,'Forecast source');page.render();
 page.inputs()[0].props.onPaste({clipboardData:{getData:()=> '3\t0\t2\n1\t1\t2'},preventDefault(){}});assert.equal(page.draft['2026-11-02/a/k'].count,'3');assert.equal(page.draft['2026-11-02/a/t'].count,'0');assert.equal(page.draft['2026-11-02/b/p'].count,'2');
 page.render();page.find(n=>n.props.id==='demand-day-filter')[0].props.onChange({target:{value:'2026-11-03'}});page.render();page.find(n=>n.type==='button')[1].props.onClick();assert.equal(page.draft['2026-11-03/a/k'].count,'3');
 const before=JSON.stringify(page.draft);page.render();page.inputs()[0].props.onPaste({clipboardData:{getData:()=> '2\t-1\t3'},preventDefault(){}});assert.equal(JSON.stringify(page.draft),before);
});
test('validation distinguishes blank/zero and rejects negatives, fractions, exponents and overflowing integers',()=>{
 for(const v of ['','0','12','2147483647'])assert.equal(grid.countError(v),'');for(const v of ['-1','1.5','1e2','Infinity','2147483648','abc'])assert.ok(grid.countError(v));
 const data=fixture(),k='2026-11-02/a/t';assert.equal(Object.keys(grid.updateCell(data,{},k,value(''))).length,0);assert.equal(grid.updateCell(data,{},k,value('0'))[k].count,'0');
});
test('save only edited cells; keep per-cell failures and revisions, preserve skills/forecast, retry only failures',async()=>{
 const data=fixture(),keys=grid.gridCells(data).slice(0,4).map(key),draft={[keys[0]]:value('0','Forecast source'),[keys[1]]:value('3'),[keys[2]]:value('-1'),[keys[3]]:value('')};let calls=[],progress=[];
 const writer={saveDemand:async(_,body)=>{calls.push(body);if(body.department_id==='t')throw Error('Revision conflict');return{requirement:{...data.requirements[0],...body,updated_at:'new'}}},clearDemand:async()=>assert.fail('empty new cells are not deletes')};
 const result=await grid.saveGrid(data,draft,writer,(n,total)=>progress.push([n,total]));assert.equal(calls.length,2);assert.equal(calls[0].required_count,0);assert.equal(calls[0].required_skill_name,'Bếp nóng');assert.equal(calls[0].sales_forecast_ref,'Forecast source');assert.equal(result.saved,2);assert.equal(Object.keys(result.errors).length,2);assert.ok(result.errors[keys[1]].includes('Revision conflict'));assert.equal(result.requirements.find(r=>r.id==='saved').required_count,0);assert.equal(result.remaining[keys[1]].count,'3');assert.equal(result.remaining[keys[2]].count,'-1');assert.equal(progress.length,4);
 calls=[];await grid.saveGrid({...data,requirements:result.requirements},result.remaining,{...writer,saveDemand:async(_,body)=>{calls.push(body);return{requirement:{...data.requirements[0],...body}}}});assert.equal(calls.length,1);assert.equal(calls[0].department_id,'t');
});
test('clearing a saved cell calls conditional DELETE; blank unknown cells never become zero',async()=>{
 const data=fixture(),existing=data.requirements[0],k=key(existing);let cleared;
 const result=await grid.saveGrid(data,{[k]:value('','Forecast source')},{saveDemand:async()=>assert.fail('must not PUT zero'),clearDemand:async(period,body)=>cleared={period,body}});
 assert.equal(cleared.period,'week');assert.equal(cleared.body.expected_updated_at,existing.updated_at);assert.equal(result.requirements.length,0);assert.equal(Object.keys(result.remaining).length,0);
});
test('unload and browser back warn for unsaved data, cancellation restores history, clean state never warns',()=>{
 const {installDemandGuard}=load('src/services/staffing-demand.guard.ts',{},{});const events={},docEvents={};let dirty=true,prompts=0,go;
 const win={history:{state:{idx:4},go:n=>go=n},confirm(){prompts++;return false},addEventListener(k,fn){events[k]=fn},removeEventListener(k){delete events[k]}},doc={addEventListener(k,fn){docEvents[k]=fn},removeEventListener(k){delete docEvents[k]}};
 const cleanup=installDemandGuard(win,doc,()=>dirty);let prevented=false,stopped=false;
 events.beforeunload({preventDefault(){prevented=true}});assert.ok(prevented);
 events.popstate({state:{idx:3},stopImmediatePropagation(){stopped=true}});assert.equal(prompts,1);assert.equal(go,1);assert.ok(stopped);
 events.popstate({state:{idx:4},stopImmediatePropagation(){}});assert.equal(prompts,1);dirty=false;prevented=false;events.beforeunload({preventDefault(){prevented=true}});assert.equal(prevented,false);events.popstate({state:{idx:3}});assert.equal(prompts,1);cleanup();assert.equal(Object.keys(events).length,0);assert.equal(Object.keys(docEvents).length,0);
});
test('sidebar/schedule links warn, cancel stops SPA navigation, accepting and opening another tab are supported',()=>{
 class Element {closest(){return this}}class Anchor extends Element {constructor(href){super();this.href=href;this.target='';this.download=''}}
 const {installDemandGuard}=load('src/services/staffing-demand.guard.ts',{}, {Element,HTMLAnchorElement:Anchor,URL});let listener,allow=false,prompts=0,prevented=false,stopped=false;
 const win={history:{state:{idx:1}},location:new URL('http://localhost:5173/manager/demand'),confirm(){prompts++;return allow},addEventListener(){},removeEventListener(){}},doc={addEventListener(_,fn){listener=fn},removeEventListener(){}};
 installDemandGuard(win,doc,()=>true);const event={target:new Anchor('http://localhost:5173/manager/schedule'),button:0,preventDefault(){prevented=true},stopPropagation(){stopped=true}};
 listener(event);assert.equal(prompts,1);assert.ok(prevented&&stopped);allow=true;prevented=stopped=false;listener(event);assert.equal(prompts,2);assert.equal(prevented,false);
 event.ctrlKey=true;listener(event);assert.equal(prompts,2);
});
