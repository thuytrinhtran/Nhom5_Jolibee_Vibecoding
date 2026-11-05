const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function harness(file,name,dependencies,user,props={}){
 let si=0,ri=0,ei=0,mi=0,tree,profile=user;const states=[],refs=[],effects=[],memos=[],pending=[];
 const memo=(factory,deps)=>{const i=mi++,old=memos[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))memos[i]={deps,value:factory()};return memos[i].value;};
 const hooks={...React,useState(v){const i=si++;if(!(i in states))states[i]=typeof v==='function'?v():v;return [states[i],n=>states[i]=typeof n==='function'?n(states[i]):n]},useRef(v){return refs[ri++]||={current:v}},useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),useEffect(fn,deps=[]){const i=ei++,old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},Date,Intl,Error,Set,Map,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true,setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}},require(id){if(id==='react')return hooks;if(id==='../../context/AuthContext')return{useAuth:()=>({user:profile})};if(id in dependencies)return dependencies[id];if(id.endsWith('.css'))return{};return require(id)}};
 vm.runInNewContext(code,box);
 function nodes(n,out=[]){if(!React.isValidElement(n))return out;out.push(n);React.Children.forEach(n.props.children,c=>nodes(c,out));return out;}
 const text=n=>!React.isValidElement(n)?String(n??''):React.Children.toArray(n.props.children).map(text).join('');
 return {states,set user(value){profile=value},find(fn){return nodes(tree).find(fn)},button(label){const b=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(b,'Missing '+label);return b},html:()=>renderToStaticMarkup(tree),async settle(){for(let i=0;i<6;i++){si=ri=ei=mi=0;tree=box.exports[name](props);while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r));}}};
}
const row=(id,status='PENDING_APPROVAL')=>({id,version:1,status,is_latest:true,workflow_enabled:true,branch_id:'branch',schedule_group_id:id,registration_periods:{work_start_date:'2026-11-09',work_end_date:'2026-11-15'},branches:{id:'branch',name:id},shift_assignments:[],approvals:[]});
function workflow(service,user={id:'gs',role:'GS',branch_id:'branch'}){
 return harness('src/pages/schedules/ScheduleWorkflow.tsx','ScheduleWorkflow',{'./scheduleWorkflow.types':{ScheduleWorkflowError:class extends Error{},TV4_SHIFT_DEFINITIONS:[]},'./scheduleWorkflow.api.service':{scheduleWorkflowApiService:service}},user,{mode:'approvals',service});
}
test('a late queue read cannot restore a pending schedule after supervisor approval',async()=>{
 const stale=deferred(),reads=[];let calls=0;
 let decisions=0;const service={mode:'api',listSchedules:async()=>{reads.push(++calls);return calls===1?[row('Current')]:calls===2?stale.promise:[]},decideSchedule:async()=>{decisions++;return {id:'Current',status:'APPROVED'}}};
 const h=workflow(service);await h.settle();h.find(n=>n.type==='button'&&n.props.className==='workflow-card-toggle').props.onClick();await h.settle();h.button('Phê duyệt').props.onClick();await h.settle();
 h.button('Làm mới').props.onClick();await h.settle();
 h.button('Xác nhận').props.onClick();h.button('Xác nhận').props.onClick();
 await h.settle();assert.equal(decisions,1);assert.ok(reads.length>=3,'Approval reloads the queue');stale.resolve([row('Stale pending')]);await h.settle();assert.ok(!h.html().includes('Stale pending'));assert.ok(!h.html().includes('data-schedule-status="PENDING_APPROVAL"'));
});
test('old account queue response and errors cannot appear under a new supervisor',async()=>{
 const first=deferred();let calls=0;
 const h=workflow({mode:'api',listSchedules:async()=>++calls===1?first.promise:[row('New scope')]});await h.settle();h.user={id:'other-gs',role:'GS',branch_id:'other'};await h.settle();first.resolve([row('Old private branch')]);await h.settle();assert.ok(h.html().includes('New scope'));assert.ok(!h.html().includes('Old private branch'));
});
test('a failed approval during refresh releases loading and keeps retry available',async()=>{
 const stale=deferred();let reads=0;
 const h=workflow({mode:'api',listSchedules:async()=>++reads===1?[row('Current')]:stale.promise,decideSchedule:async()=>{throw Error('Approval unavailable')}});
 await h.settle();h.find(n=>n.type==='button'&&n.props.className==='workflow-card-toggle').props.onClick();await h.settle();h.button('Phê duyệt').props.onClick();await h.settle();h.button('Làm mới').props.onClick();await h.settle();h.button('Xác nhận').props.onClick();await h.settle();
 assert.ok(h.html().includes('Approval unavailable'));assert.equal(h.button('Làm mới').props.disabled,false);stale.resolve([row('Stale')]);await h.settle();assert.ok(!h.html().includes('data-schedule-status="PENDING_APPROVAL"'));
});
const registrationData=()=>({employee:{full_name:'Current employee'},period:{id:'period',work_start_date:'2026-11-09',work_end_date:'2026-11-15',open_at:new Date(Date.now()-60000).toISOString(),close_at:new Date(Date.now()+600000).toISOString()},server_now:new Date().toISOString(),shifts:[{id:'s',name:'Morning',start_time:'08:00',end_time:'12:00'}],registrations:[],submission:null});
function registration(service,user={id:'employee'}){return harness('src/pages/employee/ShiftRegistration.tsx','ShiftRegistration',{'../../services/auth.service':{ApiError:class extends Error{}},'../../services/registration-mode':{getRegistrationService:()=>service,registrationDemoEnabled:false},'../../services/registration-selection':{toggleShift:(p,date,shift)=>[...p,{work_date:date,shift_id:shift}],validateSelection:()=>[],dayDeclaration:()=> 'NOT_SUBMITTED'}},user);}
test('registration save followed by failed reread preserves selections and does not claim refreshed success',async()=>{
 let loads=0,writes=0;const h=registration({load:async()=>{if(++loads>1)throw Error('Read unavailable');return registrationData()},save:async()=>{writes++;return {message:'Saved success'}}});
 await h.settle();h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange();await h.settle();h.button('Lưu nháp').props.onClick();h.button('Lưu nháp').props.onClick();await h.settle();assert.equal(writes,1);assert.ok(h.html().includes('Đã lưu đăng ký nhưng chưa tải lại được'));assert.ok(!h.html().includes('Saved success'));assert.equal(h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,true);
});
test('registration from a previous account cannot overwrite a newer loaded form',async()=>{
 const old=deferred();let calls=0;const h=registration({load:async()=>++calls===1?old.promise:{...registrationData(),employee:{full_name:'New employee'}},save:()=>assert.fail('No save')});
 await h.settle();h.user={id:'new-employee'};await h.settle();old.resolve({...registrationData(),employee:{full_name:'Old employee'}});await h.settle();assert.ok(h.html().includes('New employee'));assert.ok(!h.html().includes('Old employee'));
});
