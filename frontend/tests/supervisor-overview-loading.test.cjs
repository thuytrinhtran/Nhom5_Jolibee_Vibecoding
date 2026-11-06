const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
test('supervisor sees pending counts before history finishes and can see a separate history error',async()=>{
 const states=[],effects=[],pendingEffects=[];let si=0,ei=0,finishPending,failHistory,tree;
 const hooks={...React,useState(v){const n=si++;if(!(n in states))states[n]=typeof v==='function'?v():v;return [states[n],x=>states[n]=typeof x==='function'?x(states[n]):x];},useEffect(fn,deps){const n=ei++,old=effects[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){old?.cleanup?.();effects[n]={deps};pendingEffects.push(()=>effects[n].cleanup=fn());}}};
 const api={listSchedules:(_actor,scope)=>scope==='pending'?new Promise(resolve=>finishPending=resolve):new Promise((_,reject)=>failHistory=reject)};
 const modules={react:hooks,'react-router-dom':{Link:({children})=>React.createElement('a',null,children)},'../context/AuthContext':{useAuth:()=>({user:{id:'u',username:'s',role:'GS',branch_id:'b'}})},'../services/employee-schedule.service':{weekMonday:()=>''},'../services/shift-change.service':{},'../pages/schedules/scheduleWorkflow.api.service':{scheduleWorkflowApiService:api},'../dashboard.config':{dashboardConfig:{GS:{actions:[]}}}};
 const code=ts.transpileModule(fs.readFileSync('src/components/RoleOverview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,box={exports:{},require:id=>modules[id]??require(id)};vm.runInNewContext(code,box);
 const render=async()=>{si=ei=0;tree=box.exports.RoleOverview({role:'GS'});for(const fn of pendingEffects.splice(0))fn();await new Promise(setImmediate);return renderToStaticMarkup(tree);};
 await render();finishPending([{is_latest:true,branch_id:'b'}]);await new Promise(setImmediate);let html=await render();assert.match(html,/Lịch chờ phê duyệt/);assert.match(html,/>1<\/p>/);assert.match(html,/Đang tải/);
 failHistory(Error('unavailable'));await new Promise(setImmediate);html=await render();assert.match(html,/>1<\/p>/);assert.match(html,/Không tải được/);
});
