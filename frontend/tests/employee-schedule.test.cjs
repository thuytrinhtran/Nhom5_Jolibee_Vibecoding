const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Date,Intl,Error,require:id=>id in deps?deps[id]:require(id)};vm.runInNewContext(code,box);return box.exports;}
const tools=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized:()=>{}}});
const empty={employee:{id:'e',full_name:'Owner',branch_id:'b'},schedules:[],assignments:[]};
const shift={assignment_id:'assignment',schedule_id:'published',version:3,work_date:'2026-11-02',shift_name:'Night',start_time:'22:00:00',end_time:'06:00:00',department_name:'Kitchen',branch_name:'Le Duan',published_at:'2026-11-01T01:00:00Z'};
function component(react=React,service={}){return load('src/pages/employee/EmployeeSchedule.tsx',{
 react,'react-router-dom':{Link:({to,children})=>React.createElement('a',{href:to},children)},'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b'}})},'../../services/auth.service':{ApiError},'../../services/employee-schedule.service':{...tools,weekMonday:()=> '2026-11-02',employeeScheduleService:service},'../manager/ManagerSchedule.css':{},
});}
test('week date helpers use Vietnam timezone and service sends only week through shared auth',async()=>{
 assert.equal(tools.weekMonday(new Date('2026-11-01T18:00:00Z')),'2026-11-02');assert.equal(tools.weekMonday(new Date('2026-11-01T10:00:00Z')),'2026-10-26');assert.equal(tools.addDays('2026-12-28',7),'2027-01-04');
 let args;const {employeeScheduleService}=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized:async(...input)=>{args=input;return{result:empty}}}});assert.equal(await employeeScheduleService.week('2026-11-02'),empty);assert.equal(args[0],'?week_start=2026-11-02');assert.equal(args[2],'/employee-schedule');assert.ok(!JSON.stringify(args).includes('employee_id'));
});
test('weekly view distinguishes unpublished, unassigned days and overnight shift details',()=>{
 const {EmployeeWeekView}=component();let html=renderToStaticMarkup(React.createElement(EmployeeWeekView,{start:'2026-11-02',data:empty}));assert.equal((html.match(/Không có lịch làm việc/g)||[]).length,7);assert.ok(html.includes('chưa có lịch được công bố'));
 html=renderToStaticMarkup(React.createElement(EmployeeWeekView,{start:'2026-11-02',data:{...empty,schedules:[{id:'published'}],assignments:[shift]}}));for(const label of ['Night','22:00','06:00','Kitchen','Le Duan','phiên bản 3','kết thúc hôm sau'])assert.ok(html.includes(label),label);assert.equal((html.match(/Không có lịch làm việc/g)||[]).length,6);
});
test('page renders loading, network retry and expired session without stale schedule',()=>{
 for(const [loading,error,expired] of [[true,'',false],[false,'Network failed',false],[false,'Session expired',true]]){
  let index=0;const states=['2026-11-02',null,loading,error,expired,0,loading?'':'u/b/2026-11-02'];const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};
  const html=renderToStaticMarkup(React.createElement(component(hooks).EmployeeSchedule));assert.ok(html.includes(loading?'Đang tải lịch':expired?'Đăng nhập lại':'Thử lại'));assert.ok(!html.includes('Night'));
 }
});
test('switching week ignores late response from previous week',async()=>{
 const states=[],pending=[],calls=[];let index=0,deps,cleanup;
 const hooks={...React,useState(initial){const n=index++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v]},useEffect(effect,next){if(!deps||next.some((v,i)=>v!==deps[i])){cleanup?.();pending.push(effect);deps=next;}}};
 const {EmployeeSchedule}=component(hooks,{week:week=>new Promise(resolve=>calls.push({week,resolve}))});
 const render=()=>{index=0;return EmployeeSchedule();};const effects=()=>{for(const fn of pending.splice(0))cleanup=fn();};
 const nodes=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(nodes)];
 let tree=render();effects();const next=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Tuần sau');next.props.onClick();tree=render();effects();assert.equal(calls[1].week,'2026-11-09');
 calls[1].resolve({...empty,week_start:'2026-11-09'});await new Promise(setImmediate);calls[0].resolve({...empty,assignments:[shift]});await new Promise(setImmediate);
 assert.equal(states[1].week_start,'2026-11-09');assert.equal(states[1].assignments.length,0);assert.ok(!renderToStaticMarkup(render()).includes('Night'));
});
