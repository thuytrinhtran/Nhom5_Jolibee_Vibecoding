// Render real read-only snapshot for visual checks. No generation, AI calls or persistence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{pathToFileURL}=require('node:url');
process.chdir(path.resolve(__dirname,'..'));const dir=path.resolve(process.argv[2]),snapshot=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
function load(file,deps={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Date,Intl,URLSearchParams,require:id=>id.endsWith('.css')?{}:id in deps?deps[id]:require(id)};vm.runInNewContext(code,box);return box.exports;}
const user=snapshot.user,context=snapshot.context,saved=snapshot.saved;
const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);
const router={Link,NavLink:({to,children,className,end,...props})=>React.createElement('a',{href:to,className:className({isActive:to==='/manager/schedule'}),...props},children),useLocation:()=>({pathname:'/manager/schedule'}),useSearchParams:()=>[new URLSearchParams(),()=>{}]};
const auth={'../../context/AuthContext':{useAuth:()=>({user,logout(){}})}},views=load('src/services/scheduling.view.ts');
const ai=load('src/pages/manager/ScheduleAIPanel.tsx',{'../../services/scheduling.service':{schedulingService:{}}});
for(const name of ['create','assignments','panel','ai']){
 const values=[snapshot.periods,context.period.id,context,saved,false,false,false,'','',0,null,{preview:null,assignments:[],dirty:false,unsaved:false},'','',false,'',name==='panel'?'assignments':name,name==='ai',name==='panel'?`${context.requirements[0].work_date}/${context.requirements[0].shift_id}/${context.requirements[0].department_id}`:''];let n=0;
 const hooks={...React,useState(initial){const value=n<values.length?values[n]:typeof initial==='function'?initial():initial;n++;return[value,()=>{}]},useRef:()=>({current:null}),useEffect(){}};
 const forbidden=()=>{throw Error('Published snapshot must not render editing/mutation tools');};
 const {ManagerSchedule}=load('src/pages/manager/ManagerSchedule.tsx',{...auth,react:hooks,'react-router-dom':router,'../../services/staffing-demand.guard':{useUnsavedDemandGuard(){}},'../../services/auth.service':{ApiError:Error},'../../services/scheduling.service':{schedulingService:{}},'../../services/scheduling.view':views,'./RegistrationSummaryPanel':{RegistrationSummaryPanel:()=>null},'./ScheduleReviewPanel':{ScheduleReviewPanel:forbidden},'./MockDraftEditor':{MockDraftEditor:forbidden},'./ScheduleAIPanel':ai});
 const {AppLayout}=load('src/components/layout/AppLayout.tsx',{...auth,'react-router-dom':router,'../../dashboard.config':load('src/dashboard.config.ts'),'../../services/performance-diagnostics':{notePerformanceRoute(){},recordPerformanceRender(){}},'../../assets/jollibee-logo.jpg':{default:pathToFileURL(path.resolve('src/assets/jollibee-logo.jpg')).href}});
 const css=['src/index.css','src/workspace.css','src/pages/manager/ManagerSchedule.css','src/pages/manager/ManagerPlanner.css','src/pages/manager/ScheduleAIPanel.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
 const body=renderToStaticMarkup(React.createElement(AppLayout,null,React.createElement(ManagerSchedule)));
 fs.writeFileSync(path.join(dir,name+'.html'),`<!doctype html><html lang="vi"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Read-only manager snapshot</title><style>${css}</style><body>${body}</body></html>`);
}
console.log('Rendered 4 published-schedule views from real data. No API calls or DB writes.');
