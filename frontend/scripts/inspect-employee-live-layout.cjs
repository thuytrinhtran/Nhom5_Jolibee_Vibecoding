// Read an existing SELECT-only snapshot. Never logs in, sends API calls, invents rows or mutates DB.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{pathToFileURL}=require('node:url');
process.chdir(path.resolve(__dirname,'..'));const dir=path.resolve(process.argv[2]),snapshot=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
function load(file,deps={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Date,Intl,URLSearchParams,require:id=>id.endsWith('.css')?{}:id in deps?deps[id]:require(id)};vm.runInNewContext(code,box);return box.exports;}
const helpers=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized(){throw Error('NO_NETWORK_IN_LAYOUT_CHECK');}}}),statuses=load('src/services/shift-change.service.ts',{'./auth.service':{authorized(){throw Error('NO_NETWORK_IN_LAYOUT_CHECK');}}}),user=snapshot.user,start=snapshot.week.week_start;
const auth={'../../context/AuthContext':{useAuth:()=>({user,logout(){}})}},Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);
const router=(pathname,tab)=>({Link,NavLink:({to,children,className,end,...props})=>React.createElement('a',{href:to,className:className({isActive:to===pathname}),...props},children),useLocation:()=>({pathname}),useSearchParams:()=>[new URLSearchParams(tab?'tab='+tab:'')]});
const hooks=values=>{let n=0,r=0;const refs=[];return {...React,useState:()=>[values[n++],()=>{}],useEffect(){},useRef:()=>refs[r++]??={current:null}};};
function render(name){const tab=name==='dashboard'?'request':name,pathname=name==='dashboard'?'/employee':'/employee/support';
 const common={...auth,'react-router-dom':router(pathname,tab),'../../services/auth.service':{ApiError:Error},'../../services/employee-schedule.service':helpers,'../../services/shift-change.service':statuses};
 const {EmployeeSchedule}=load('src/pages/employee/EmployeeSchedule.tsx',{...common,react:hooks([start,snapshot.week,false,'',false,0,`${user.id}/${user.branch_id}/${start}`,'week'])});
 const dashboard=load('src/pages/employee/EmployeeDashboard.tsx',{...common,react:hooks([snapshot.queue.sources.slice(0,3),false,'',0,`${user.id}/${user.branch_id}`]),'./EmployeeSchedule':{EmployeeSchedule}});
 const action=tab==='incident'?'REPORT':'CREATE_REQUEST';
 const {ShiftChanges}=load('src/pages/employee/ShiftChanges.tsx',{...common,react:hooks([snapshot.queue,false,false,'','',false,start,tab==='history'?[]:snapshot.week.assignments,'','','',null,[],false,'','','',0,`${user.id}/${user.branch_id}/false/${start}/${action}`,0,tab==='history'?'all':'open',0])});
 const {EmployeeSupport}=load('src/pages/employee/EmployeeSupport.tsx',{'react-router-dom':router(pathname,tab),'./ShiftChanges':{ShiftChanges}});
 const {AppLayout}=load('src/components/layout/AppLayout.tsx',{...auth,'react-router-dom':router(pathname,tab),'../../dashboard.config':load('src/dashboard.config.ts'),'../../services/performance-diagnostics':{notePerformanceRoute(){},recordPerformanceRender(){}},'../../assets/jollibee-logo.jpg':{default:pathToFileURL(path.resolve('src/assets/jollibee-logo.jpg')).href}});
 const css=['src/index.css','src/workspace.css','src/pages/manager/ManagerSchedule.css','src/pages/employee/EmployeeWorkspace.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
 const body=renderToStaticMarkup(React.createElement(AppLayout,null,React.createElement(name==='dashboard'?dashboard.EmployeeDashboard:EmployeeSupport)));
 fs.writeFileSync(path.join(dir,name+'.html'),`<!doctype html><html lang="vi"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Read-only database snapshot</title><style>${css}</style><body>${body}</body></html>`);
}
for(const name of ['dashboard','request','incident','history'])render(name);console.log('Rendered actual read-only snapshot locally; no API calls or DB writes.');
