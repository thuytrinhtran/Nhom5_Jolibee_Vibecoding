// Local visual fixtures only. No login, network API or Supabase access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
process.chdir(path.resolve(__dirname,'..'));
const out=path.resolve('../docs/employee-ui-20261103');fs.mkdirSync(out,{recursive:true});
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const ctx={exports:{},Date,Intl,URLSearchParams,require:id=>id.endsWith('.css')?{}:id in deps?deps[id]:require(id)};vm.runInNewContext(code,ctx);return ctx.exports;}
const user={id:'visual-user',role:'NV',username:'visual',branch_id:'visual-branch',branch_name:'Jollibee Lê Duẩn',employee:{full_name:'Nhân viên xem bố cục'}};
const helpers=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized:()=>{throw Error('NO_NETWORK_IN_VISUAL_FIXTURE');}}});
const start=helpers.weekMonday(),own=[0,1,2,4,6].map((n,i)=>({assignment_id:'visual-'+i,work_date:helpers.addDays(start,n),shift_name:['Sáng','Chiều','Tối'][i%3],start_time:['08:00','13:00','18:00'][i%3],end_time:['12:00','17:00','22:00'][i%3],department_name:['Bếp','Phục vụ','Thu ngân'][i%3],branch_name:'Jollibee Lê Duẩn',published_at:'2026-11-01T02:00:00Z',feedback_deadline_at:'2099-11-01T02:00:00Z'}));
const links=pathname=>({Link:({to,children,...p})=>React.createElement('a',{href:to,...p},children),NavLink:({to,children,className,end,...p})=>React.createElement('a',{href:to,className:typeof className==='function'?className({isActive:pathname===to}):className,...p},children),useLocation:()=>({pathname}),useSearchParams:()=>[new URLSearchParams()]});
const config=load('src/dashboard.config.ts',{});
const common={'../../context/AuthContext':{useAuth:()=>({user,logout(){}})},'../../services/auth.service':{ApiError:Error}};
function shell(content,pathname){const {AppLayout}=load('src/components/layout/AppLayout.tsx',{...common,'react-router-dom':links(pathname),'../../dashboard.config':config,'../../services/performance-diagnostics':{notePerformanceRoute(){},recordPerformanceRender(){}},'../../assets/jollibee-logo.jpg':{default:'../../frontend/src/assets/jollibee-logo.jpg'}});return React.createElement(AppLayout,null,content);}
function renderChange(incident){let stateIndex=0,refIndex=0;const refs=[];const queue={enabled:true,sources:[],invitations:[]};
 const initial=[queue,false,false,'','',false,start,own,own[0].assignment_id,incident?'Tôi không thể đến làm do có việc khẩn cấp.':'Tôi có lịch thi nên cần người nhận ca thay.','',null,[],false,'','','',0,`${user.id}/${user.branch_id}/false/${start}/${incident?'REPORT':'CREATE_REQUEST'}`,incident?0:1,'open',0];
 const hooks={...React,useState:()=>{const n=stateIndex++;return[initial[n],()=>{}]},useRef:()=>refs[refIndex++]??={current:null},useEffect(){}};
 const {ShiftChanges}=load('src/pages/employee/ShiftChanges.tsx',{...common,react:hooks,'react-router-dom':links('/employee/shift-requests'),'../../services/employee-schedule.service':{...helpers,employeeScheduleService:{}},'../../services/shift-change.service':{shiftChangeService:{}}});
 return React.createElement(ShiftChanges,{initialAction:incident?'REPORT':'CREATE_REQUEST'});
}
const weekData={schedules:[{id:'visual'}],assignments:own};let calendarState=0;const calendarValues=[start,weekData,false,'',false,0,`${user.id}/${user.branch_id}/${start}`,'week'];
const {EmployeeSchedule}=load('src/pages/employee/EmployeeSchedule.tsx',{...common,react:{...React,useState:()=>[calendarValues[calendarState++],()=>{}],useEffect(){}},'react-router-dom':links('/employee/schedule'),'../../services/employee-schedule.service':helpers});
const css=['src/index.css','src/workspace.css','src/pages/manager/ManagerSchedule.css','src/pages/employee/EmployeeWorkspace.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
for(const [name,route,content]of [
 ['calendar','/employee/schedule',React.createElement(EmployeeSchedule)],
 ['request','/employee/shift-requests',renderChange(false)],['incident','/employee/incidents',renderChange(true)],
]){
 const body=renderToStaticMarkup(shell(content,route));fs.writeFileSync(path.join(out,name+'.html'),`<!doctype html><html lang="vi"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local layout fixture</title><style>${css}</style><body>${body}<script>document.body.dataset.layout=JSON.stringify({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth});</script></body></html>`);
}
console.log('Created 3 local HTML layout fixtures; no network or Supabase calls.');
