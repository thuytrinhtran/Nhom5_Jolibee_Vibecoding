const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
function load(file,deps,globals={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Error,Date,Intl,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true},...globals,require:id=>id in deps?deps[id]:(id==='../../components/Toast'?require('./helpers/ui-components.cjs'):require(id))};vm.runInNewContext(code,box);return box.exports;}
const presentation=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized:()=>{}}});
const statusTools=load('src/services/shift-change.service.ts',{'./auth.service':{authorized:()=>{}}});
const source={kind:'REQUEST',id:'request',original_assignment_id:'original',reason:'Personal',status:'SEARCHING',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',owner_name:'Owner',proposed_employee_id:null,actionable:true,version:1};
const invite={id:'invite',source_id:'request',kind:'REQUEST',target_name:'Recipient',status:'PENDING',effective_status:'PENDING',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',expires_at:'2026-11-02T02:00:00Z'};
const own={assignment_id:'original',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',feedback_deadline_at:'2099-11-01T01:00:00Z'};
const flush=()=>new Promise(setImmediate);
function harness(role,queue,act=async()=>({status:'PENDING'}),props={},query='',confirm=()=>true){
 const states=[],refs=[],slots=[],pending=[],calls=[],reads={week:0,queue:0,candidates:0};let s=0,r=0,e=0;
 const hooks={...React,useState(initial){const n=s++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v]},useRef(initial){return refs[r++]||={current:initial}},useEffect(fn,deps){const n=e++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){old?.cleanup?.();slots[n]={deps};pending.push(()=>slots[n].cleanup=fn());}}};
 const module=load('src/pages/employee/ShiftChanges.tsx',{react:hooks,'react-router-dom':{useSearchParams:()=>[new URLSearchParams(query)],Link:({to,children})=>React.createElement('a',{href:to},children)},'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b',role}})},'../../services/auth.service':{ApiError},'../../services/employee-schedule.service':{...presentation,weekMonday:()=> '2026-11-02',addDays:(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),employeeScheduleService:{week:async()=>{reads.week++;return {assignments:[own]}}}},'../../services/shift-change.service':{changeStatus:statusTools.changeStatus,shiftChangeService:{read:async()=>{reads.queue++;return queue;},candidates:async()=>[{id:'candidate',full_name:'Recipient',employee_code:'E002',skill_level:'REGULAR'}],act:async(...args)=>{calls.push(args);return act(...args)}}},'../manager/ManagerSchedule.css':{},'./EmployeeWorkspace.css':{}},{window:{confirm}});
 const render=()=>{s=r=e=0;return module.ShiftChanges(props);};const effects=()=>{for(const fn of pending.splice(0))fn();};
 const nodes=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(nodes)];
 const button=(tree,text)=>nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes(text));
 return{states,calls,reads,render,effects,nodes,button};
}
test('client carries only action data and idempotency ID through existing authorized backend transport',async()=>{
 const calls=[];const {shiftChangeService}=load('src/services/shift-change.service.ts',{'./auth.service':{authorized:async(...args)=>{calls.push(args);return{result:[]}}}});
 await shiftChangeService.read();await shiftChangeService.candidates('assignment');await shiftChangeService.act('ACCEPT',{invitation_id:'invite'},'request-id');
 assert.equal(calls[0][2],'/shift-changes');assert.equal(calls[1][0],'/candidates?assignment_id=assignment');assert.deepEqual(JSON.parse(calls[2][1].body),{action:'ACCEPT',data:{invitation_id:'invite'},request_id:'request-id'});
});
test('employee create form preserves failed edits and request ID for retry; no automatic replacement',async()=>{
 let attempts=0;const h=harness('NV',{enabled:true,sources:[],invitations:[]},async()=>{if(++attempts===1)throw Error('Network failure');return{status:'PENDING'}});
 h.render();h.effects();await flush();let tree=h.render();
 const selects=h.nodes(tree).filter(n=>n.type==='select');selects[0].props.onChange({target:{value:'original'}});
 tree=h.render();h.effects();await flush();tree=h.render();h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 tree=h.render();h.nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'Need replacement'}});
 tree=h.render();h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 tree=h.render();assert.equal(h.calls.length,0,'review does not write');h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();
 tree=h.render();assert.ok(renderToStaticMarkup(tree).includes('Network failure'));assert.ok(renderToStaticMarkup(tree).includes('Need replacement'));
 h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();assert.equal(h.calls[0][2],h.calls[1][2]);assert.equal(h.calls[0][0],'CREATE_REQUEST');assert.equal(h.calls[0][1].assignment_id,'original');assert.ok(!JSON.stringify(h.calls).includes('employee_id'));
});
test('accept invitation records consent and waits for manager; expired invitations have no accept button',async()=>{
 const h=harness('NV',{enabled:true,sources:[],invitations:[invite]},async()=>({status:'ACCEPTED'}));h.render();h.effects();await flush();let tree=h.render();h.button(tree,'Nhận lời mời').props.onClick();await flush();tree=h.render();assert.ok(renderToStaticMarkup(tree).includes('chờ quản lý xác nhận'));assert.equal(h.calls[0][0],'ACCEPT');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{invitation_id:'invite'});
 const expired=harness('NV',{enabled:true,sources:[],invitations:[{...invite,effective_status:'EXPIRED'}]});expired.render();expired.effects();await flush();assert.equal(expired.button(expired.render(),'Nhận lời mời'),undefined);
});
test('manager approval explicitly names accepted invitation and confirms; disabled backend locks writes',async()=>{
 const accepted={...invite,status:'ACCEPTED',effective_status:'ACCEPTED',valid_when_confirmed:true};
 const h=harness('QL',{enabled:true,sources:[source],invitations:[accepted]},async()=>({status:'APPROVED'}));h.render();h.effects();await flush();let tree=h.render();
 // Open the source using its source label rather than calling mutation directly.
 const sourceButton=h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đổi ca'));assert.ok(sourceButton);sourceButton.props.onClick();tree=h.render();h.effects();await flush();tree=h.render();h.button(tree,'Phê duyệt người này').props.onClick();await flush();assert.equal(h.calls[0][0],'APPROVE');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{kind:'REQUEST',source_id:'request',invitation_id:'invite'});
 const off=harness('NV',{enabled:false,sources:[],invitations:[invite]});off.render();off.effects();await flush();assert.equal(off.button(off.render(),'Nhận lời mời').props.disabled,true);
});
test('manager expiry closes request into completed history after fresh read without approving a replacement',async()=>{
 const q={enabled:true,sources:[{...source}],invitations:[{...invite,effective_status:'EXPIRED'}]};
 const h=harness('QL',q,async()=>{q.sources=[{...source,status:'REJECTED',decision_reason:'Không tìm được người thay'}];q.invitations=[{...invite,status:'EXPIRED',effective_status:'EXPIRED'}];return {status:'REJECTED'};});
 h.render();h.effects();await flush();let tree=h.render();h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đổi ca')).props.onClick();
 tree=h.render();h.effects();await flush();tree=h.render();const button=h.button(tree,'Kết thúc yêu cầu');assert.equal(button.props.disabled,false);button.props.onClick();await flush();
 tree=h.render();h.effects();await flush();tree=h.render();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'EXPIRE');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{kind:'REQUEST',source_id:'request'});
 assert.ok(h.reads.queue>=2);assert.ok(renderToStaticMarkup(tree).includes('Không tìm được người thay'));assert.ok(h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đã hoàn tất')).props['aria-pressed']);
});
test('expiry action is disabled without expired invitations or when a valid acceptance exists',async()=>{
 for(const invitations of [[invite],[{...invite,effective_status:'EXPIRED'},{...invite,id:'accepted',status:'ACCEPTED',effective_status:'ACCEPTED',valid_when_confirmed:true}]]){
  const h=harness('QL',{enabled:true,sources:[source],invitations});h.render();h.effects();await flush();let tree=h.render();h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đổi ca')).props.onClick();tree=h.render();h.effects();await flush();tree=h.render();assert.equal(h.button(tree,'Kết thúc yêu cầu').props.disabled,true);assert.equal(h.calls.length,0);
 }
});
test('cancelling expiry confirmation preserves the open request and performs no mutation',async()=>{
 let confirmations=0;const h=harness('QL',{enabled:true,sources:[source],invitations:[{...invite,effective_status:'EXPIRED'}]},undefined,{},'',()=>{confirmations++;return false;});
 h.render();h.effects();await flush();let tree=h.render();h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đổi ca')).props.onClick();tree=h.render();h.effects();await flush();tree=h.render();h.button(tree,'Kết thúc yêu cầu').props.onClick();await flush();assert.equal(confirmations,1);assert.equal(h.calls.length,0);assert.ok(renderToStaticMarkup(h.render()).includes('Personal'));
});
test('manager can request closure of a stale source even without expired invitations',async()=>{
 const h=harness('QL',{enabled:true,sources:[{...source,actionable:false}],invitations:[]},async()=>({status:'REJECTED'}));
 h.render();h.effects();await flush();let tree=h.render();h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đổi ca')).props.onClick();tree=h.render();h.effects();await flush();tree=h.render();
 assert.ok(renderToStaticMarkup(tree).includes('Lịch hoặc phân công nguồn không còn hiệu lực'));const button=h.button(tree,'Kết thúc yêu cầu');assert.equal(button.props.disabled,false);button.props.onClick();await flush();assert.equal(h.calls[0][0],'EXPIRE');
});
test('loading, network errors and expired session show truthful feedback',async()=>{
 const h=harness('NV',{enabled:true,sources:[],invitations:[invite]},async()=>{throw new ApiError('Session expired',401)});assert.ok(renderToStaticMarkup(h.render()).includes('Đang tải'));h.effects();await flush();h.button(h.render(),'Nhận lời mời').props.onClick();await flush();assert.ok(renderToStaticMarkup(h.render()).includes('Đăng nhập lại'));
});

test('incident is a distinct quick form: REPORT only, no proposed replacement, tracks incidents separately',async()=>{
 const incident={...source,kind:'INCIDENT',id:'incident',reason:'Cannot attend',status:'REPORTED'};
 const h=harness('NV',{enabled:true,sources:[source,incident],invitations:[]},async()=>({status:'REPORTED'}),{initialAction:'REPORT'});
 h.render();h.effects();await flush();let tree=h.render();
 const html=renderToStaticMarkup(tree);assert.ok(html.includes('Báo cáo sự cố'));assert.ok(html.includes('Cannot attend'));assert.ok(!html.includes('Personal'));assert.ok(!html.includes('employee-steps'));
 assert.equal(h.nodes(tree).filter(n=>n.type==='select').length,1);
 h.nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'original'}});
 h.nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'Unexpected incident'}});
 tree=h.render();h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();
 assert.equal(h.calls[0][0],'REPORT');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{assignment_id:'original',reason:'Unexpected incident'});
});

test('tracking separates open and completed requests and deep links select only owned assignments',async()=>{
 const h=harness('NV',{enabled:true,sources:[source,{...source,id:'done',reason:'Completed reason',status:'APPROVED'}],invitations:[]},undefined,{},'week_start=2026-11-02&assignment_id=original');
 h.render();h.effects();await flush();let tree=h.render();assert.equal(h.nodes(tree).find(n=>n.type==='select').props.value,'original');
 assert.ok(!renderToStaticMarkup(tree).includes('Completed reason'));
 h.nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đã hoàn tất')).props.onClick();
 tree=h.render();assert.ok(renderToStaticMarkup(tree).includes('Completed reason'));assert.ok(!renderToStaticMarkup(tree).includes('Personal'));
 const forged=harness('NV',{enabled:true,sources:[],invitations:[]},undefined,{},'assignment_id=another-employees-assignment');forged.render();forged.effects();await flush();assert.equal(forged.nodes(forged.render()).find(n=>n.type==='select').props.value,'');assert.equal(forged.calls.length,0);
});

test('closed feedback window cannot submit a change request from the client',async()=>{
 const previous=own.feedback_deadline_at;own.feedback_deadline_at='2000-01-01T00:00:00Z';
 try{
  const h=harness('NV',{enabled:true,sources:[],invitations:[]});h.render();h.effects();await flush();let tree=h.render();
  h.nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'original'}});tree=h.render();
  assert.equal(h.button(tree,'Tiếp tục').props.disabled,true);
  h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();assert.equal(h.calls.length,0);
  assert.ok(renderToStaticMarkup(tree).includes('/employee/incidents?week_start='));
 }finally{own.feedback_deadline_at=previous;}
});

test('history pagination keeps all requests accessible without rendering the whole list',async()=>{
 const h=harness('NV',{enabled:true,sources:Array.from({length:7},(_,i)=>({...source,id:'r'+i,reason:'Unique reason '+i})),invitations:[]});
 h.render();h.effects();await flush();let tree=h.render();assert.ok(!renderToStaticMarkup(tree).includes('Unique reason 6'));
 h.button(tree,'Sau').props.onClick();tree=h.render();assert.ok(renderToStaticMarkup(tree).includes('Unique reason 6'));assert.ok(!renderToStaticMarkup(tree).includes('Unique reason 0'));
});

test('unified history includes both kinds and completed results without loading the schedule or write form',async()=>{
 const h=harness('NV',{enabled:true,sources:[source,{...source,id:'incident',kind:'INCIDENT',status:'RESOLVED',reason:'Incident history',decision_reason:'Replacement confirmed'}],invitations:[invite]},undefined,{historyOnly:true,compact:true});
 h.render();h.effects();await flush();const tree=h.render(),html=renderToStaticMarkup(tree);
 assert.equal(h.reads.queue,1);assert.equal(h.reads.week,0);assert.equal(h.nodes(tree).filter(n=>n.type==='form').length,0);
 assert.ok(html.includes('Personal'));assert.ok(html.includes('Incident history'));assert.ok(html.includes('Replacement confirmed'));assert.ok(html.includes('Chi tiết xử lý'));assert.equal(h.calls.length,0);
});
