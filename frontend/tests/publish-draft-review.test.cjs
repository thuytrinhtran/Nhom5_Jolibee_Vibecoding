const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const row={id:'draft',version:5,status:'DRAFT',period_id:'p',branch_id:'b',schedule_group_id:'g',is_latest:true,registration_periods:{work_start_date:'2026-11-09',work_end_date:'2026-11-15'}};
const saved={schedule:{...row},source:'supabase',assignments:[],generation_snapshot:null};
function harness(read){
 const states=[],effects=[],pending=[],timers=new Map();let si=0,ei=0,tree,tid=0,notified=0;
 const hooks={...React,useState(v){const i=si++;if(!(i in states))states[i]=v;return[states[i],n=>states[i]=typeof n==='function'?n(states[i]):n]},useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}}};
 const Panel=()=>null;
 const source=ts.transpileModule(fs.readFileSync('src/pages/schedules/PublishDraftReview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},Error,AbortController,setTimeout(fn){timers.set(++tid,fn);return tid},clearTimeout(id){timers.delete(id)},require(id){if(id==='react')return hooks;if(id==='../../services/scheduling.service')return{schedulingService:{read}};if(id==='../manager/ScheduleReviewPanel')return{ScheduleReviewPanel:Panel};return require(id)}};vm.runInNewContext(source,box);
 const onSubmitted=()=>notified++,onClose=()=>{},onBusyChange=()=>{};
 const nodes=n=>React.isValidElement(n)?[n,...React.Children.toArray(n.props.children).flatMap(nodes)]:[];
 return {timers,states,get notified(){return notified},html:()=>renderToStaticMarkup(tree),panel:()=>nodes(tree).find(n=>n.type===Panel),retry:()=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='Thử tải lại DRAFT').props.onClick(),async settle(){for(let i=0;i<4;i++){si=ei=0;tree=box.exports.PublishDraftReview({schedule:row,onSubmitted,onClose,onBusyChange});while(pending.length)pending.shift()();await new Promise(setImmediate);}},unmount(){for(const e of effects)e.cleanup?.();}};
}
test('publish opens the exact DRAFT and prepares on this page without navigation or automatic submit',async()=>{
 let reads=0;const h=harness(async(id,signal)=>{reads++;assert.equal(id,row.id);assert.equal(signal.aborted,false);return saved});await h.settle();
 assert.equal(reads,1);assert.equal(h.panel().props.saved,saved);assert.equal(h.panel().props.prepareOnMount,true);assert.equal(h.notified,0);assert.ok(h.html().includes('DRAFT phiên bản 5'));h.unmount();
});
test('DRAFT loading failure has a retry and cannot prepare or claim success',async()=>{
 let fail=true;const h=harness(async()=>{if(fail)throw Error('Không thể đọc DRAFT');return saved});await h.settle();assert.match(h.html(),/Không thể đọc DRAFT/);assert.equal(h.panel(),undefined);assert.equal(h.notified,0);
 fail=false;h.retry();await h.settle();assert.ok(h.panel());h.unmount();
});
test('changed version, branch, period, group or status cannot enter the send step',async()=>{
 for(const patch of [{version:6},{branch_id:'foreign'},{period_id:'foreign'},{schedule_group_id:'foreign'},{status:'PENDING_APPROVAL'}]){const h=harness(async()=>({...saved,schedule:{...saved.schedule,...patch}}));await h.settle();assert.equal(h.panel(),undefined);assert.match(h.html(),/DRAFT đã đổi/);h.unmount();}
});
test('hanging DRAFT read ends loading after the deadline and ignores late data',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));await h.settle();assert.match(h.html(),/Đang tải DRAFT/);for(const fn of h.timers.values())fn();await h.settle();assert.match(h.html(),/Hết thời gian tải DRAFT/);assert.equal(h.states[2],false);resolve(saved);await h.settle();assert.equal(h.panel(),undefined);assert.equal(h.notified,0);h.unmount();
});
