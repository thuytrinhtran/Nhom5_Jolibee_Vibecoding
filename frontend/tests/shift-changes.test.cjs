const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Error,Date,Intl,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true},require:id=>id in deps?deps[id]:require(id)};vm.runInNewContext(code,box);return box.exports;}
const source={kind:'REQUEST',id:'request',original_assignment_id:'original',reason:'Personal',status:'SEARCHING',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',owner_name:'Owner',proposed_employee_id:null,actionable:true,version:1};
const invite={id:'invite',source_id:'request',kind:'REQUEST',target_name:'Recipient',status:'PENDING',effective_status:'PENDING',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',expires_at:'2026-11-02T02:00:00Z'};
const own={assignment_id:'original',work_date:'2026-11-02',shift_name:'Morning',start_time:'08:00',end_time:'12:00',department_name:'Kitchen',feedback_deadline_at:'2026-11-01T01:00:00Z'};
const flush=()=>new Promise(setImmediate);
function harness(role,queue,act=async()=>({status:'PENDING'})){
 const states=[],refs=[],slots=[],pending=[],calls=[];let s=0,r=0,e=0;
 const hooks={...React,useState(initial){const n=s++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v]},useRef(initial){return refs[r++]||={current:initial}},useEffect(fn,deps){const n=e++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){old?.cleanup?.();slots[n]={deps};pending.push(()=>slots[n].cleanup=fn());}}};
 const module=load('src/pages/employee/ShiftChanges.tsx',{react:hooks,'react-router-dom':{Link:({to,children})=>React.createElement('a',{href:to},children)},'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b',role}})},'../../services/auth.service':{ApiError},'../../services/employee-schedule.service':{weekMonday:()=> '2026-11-02',addDays:(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),employeeScheduleService:{week:async()=>({assignments:[own]})}},'../../services/shift-change.service':{shiftChangeService:{read:async()=>queue,candidates:async()=>[{id:'candidate',full_name:'Recipient',employee_code:'E002',skill_level:'REGULAR'}],act:async(...args)=>{calls.push(args);return act(...args)}}},'../manager/ManagerSchedule.css':{}});
 const render=()=>{s=r=e=0;return module.ShiftChanges({});};const effects=()=>{for(const fn of pending.splice(0))fn();};
 const nodes=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(nodes)];
 const button=(tree,text)=>nodes(tree).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes(text));
 return{states,calls,render,effects,nodes,button};
}
test('client carries only action data and idempotency ID through existing authorized backend transport',async()=>{
 const calls=[];const {shiftChangeService}=load('src/services/shift-change.service.ts',{'./auth.service':{authorized:async(...args)=>{calls.push(args);return{result:[]}}}});
 await shiftChangeService.read();await shiftChangeService.candidates('assignment');await shiftChangeService.act('ACCEPT',{invitation_id:'invite'},'request-id');
 assert.equal(calls[0][2],'/shift-changes');assert.equal(calls[1][0],'/candidates?assignment_id=assignment');assert.deepEqual(JSON.parse(calls[2][1].body),{action:'ACCEPT',data:{invitation_id:'invite'},request_id:'request-id'});
});
test('employee create form preserves failed edits and request ID for retry; no automatic replacement',async()=>{
 let attempts=0;const h=harness('NV',{enabled:true,sources:[],invitations:[]},async()=>{if(++attempts===1)throw Error('Network failure');return{status:'PENDING'}});
 h.render();h.effects();await flush();let tree=h.render();
 const selects=h.nodes(tree).filter(n=>n.type==='select');selects[0].props.onChange({target:{value:'original'}});h.nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'Need replacement'}});
 tree=h.render();h.effects();await flush();tree=h.render();h.nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();
 tree=h.render();assert.ok(renderToStaticMarkup(tree).includes('Network failure'));assert.equal(h.states[10],'Need replacement');
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
test('loading, network errors and expired session show truthful feedback',async()=>{
 const h=harness('NV',{enabled:true,sources:[],invitations:[invite]},async()=>{throw new ApiError('Session expired',401)});assert.ok(renderToStaticMarkup(h.render()).includes('Đang tải'));h.effects();await flush();h.button(h.render(),'Nhận lời mời').props.onClick();await flush();assert.ok(renderToStaticMarkup(h.render()).includes('Đăng nhập lại'));
});
