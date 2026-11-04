const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,deps={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Date,Intl,URLSearchParams,require:id=>id.endsWith('.css')?{}:id in deps?deps[id]:require(id)};vm.runInNewContext(code,box);return box.exports;}
const dates=load('src/services/employee-schedule.service.ts',{'./auth.service':{authorized(){}}});
const auth={'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b'}})}};
const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);
test('dashboard hour and next-shift KPIs use published response including overnight assignments',()=>{
 const {employeeWeekStats}=load('src/pages/employee/EmployeeSchedule.tsx',{...auth,'react-router-dom':{Link},'../../services/auth.service':{},'../../services/employee-schedule.service':dates});
 const assignments=[{work_date:'2026-11-03',start_time:'22:00:00',end_time:'06:00:00'},{work_date:'2026-11-03',start_time:'08:00:00',end_time:'12:00:00'}];
 const result=employeeWeekStats({assignments},Date.parse('2026-11-03T00:00:00Z'));assert.equal(result.count,2);assert.equal(result.hours,12);assert.equal(result.next.start_time,'08:00:00');
 assert.equal(employeeWeekStats({assignments},Date.parse('2026-11-04T00:00:00Z')).next,undefined);assert.equal(assignments[0].start_time,'22:00:00','must not mutate API result');
});
test('overview shows at most three newest requests across both kinds and embeds calendar',()=>{
 const sources=Array.from({length:5},(_,i)=>({id:String(i),kind:i%2?'INCIDENT':'REQUEST',created_at:`2026-11-0${i+1}T00:00:00Z`,work_date:'2026-11-02',shift_name:'Morning',department_name:'Kitchen',status:'PENDING'}));
 let n=0;const values=[sources.slice(0,3),false,'',0,'u/b'];
 const mod=load('src/pages/employee/EmployeeDashboard.tsx',{...auth,react:{...React,useState:()=>[values[n++],()=>{}],useEffect(){}},'react-router-dom':{Link},'../../services/shift-change.service':{shiftChangeService:{},changeStatus:()=> 'Chờ xử lý'},'../../services/employee-schedule.service':dates,'./EmployeeSchedule':{EmployeeSchedule:({dashboard})=>React.createElement('div',{'data-embedded-calendar':String(dashboard)})}});
 assert.deepEqual(Array.from(mod.recentRequests(sources).map(x=>x.id)),['4','3','2']);
 const html=renderToStaticMarkup(React.createElement(mod.EmployeeDashboard));assert.ok(html.includes('data-embedded-calendar="true"'));assert.equal((html.match(/class="employee-recent-item"/g)||[]).length,3);assert.ok(html.includes('/employee/support?tab=history'));
});
test('support tabs preserve shift context and support old incident route defaults',()=>{
 for(const [query,initialTab,expected]of [['tab=history&assignment_id=owned','request','history'],['week_start=2026-11-02','incident','incident'],['tab=unknown','request','request']]){
  const {EmployeeSupport}=load('src/pages/employee/EmployeeSupport.tsx',{'react-router-dom':{Link,useSearchParams:()=>[new URLSearchParams(query)]},'./ShiftChanges':{ShiftChanges:p=>React.createElement('div',{'data-history':String(p.historyOnly),'data-action':p.initialAction})}});
  const html=renderToStaticMarkup(React.createElement(EmployeeSupport,{initialTab}));assert.equal((html.match(/aria-current="page"/g)||[]).length,1);assert.ok(html.includes(`data-history="${expected==='history'}"`));assert.ok(html.includes(`data-action="${expected==='incident'?'REPORT':'CREATE_REQUEST'}"`));if(query.includes('assignment_id'))assert.ok(html.includes('assignment_id=owned'));
 }
});
