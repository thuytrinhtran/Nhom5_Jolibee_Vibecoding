const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,deps){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const box={exports:{},Date,Error,require:id=>id in deps?deps[id]:id.endsWith('.css')?{}:require(id)};vm.runInNewContext(code,box);return box.exports;}
test('official calendar excludes unpublished and replaced rows and keeps latest published version',()=>{
 const {publishedAssignments}=load('src/pages/manager/OfficialSchedule.tsx',{'react':React,'react-router-dom':{},'../../context/AuthContext':{},'../../services/scheduling.service':{},'../../services/scheduling.view':{}});
 const data={schedules:[{id:'p',version:1,status:'PUBLISHED',published_at:'date',schedule_group_id:'g'},{id:'d',version:2,status:'DRAFT',schedule_group_id:'g'}],assignments:[{id:'old',schedule_id:'p',status:'REPLACED'},{id:'new',schedule_id:'p',status:'ACTIVE'},{id:'draft',schedule_id:'d',status:'DRAFT'}]};
 assert.deepEqual(Array.from(publishedAssignments(data),r=>r.id),['new']);assert.equal(publishedAssignments({...data,schedules:[data.schedules[1]]}).length,0);
 assert.throws(()=>publishedAssignments({...data,schedules:[...data.schedules,{id:'bad',version:3,status:'PUBLISHED',published_at:'date',schedule_group_id:'other'}]}));
});
test('manager dashboard distinguishes zero, no schedule, loading and errors without fabricated totals',()=>{
 function render(data,loading=false,error=''){const states=[[{id:'w',work_start_date:'2026-11-02',work_end_date:'2026-11-08',schedules:[]}],'w',data,loading,error,0];let n=0;
 const {ManagerDashboard}=load('src/pages/manager/ManagerDashboard.tsx',{react:{...React,useState:()=>[states[n++],()=>{}],useEffect:()=>{}},'react-router-dom':{Link:({children,to})=>React.createElement('a',{href:to},children)},'../../context/AuthContext':{useAuth:()=>({user:{branch_id:'b',branch_name:'Cửa hàng'}})},'../../services/scheduling.service':{},'../../services/manager-overview.service':{},'../../services/scheduling.view':{statusLabel:s=>({PUBLISHED:'Đã công bố'}[s]??s),weekLabel:()=> 'Tuần'}});
 return renderToStaticMarkup(React.createElement(ManagerDashboard));}
 const data={employee_count:3,registered_employees:0,schedule_status:'PUBLISHED',assignment_count:0,pending_requests:0,shortage_cells:0,assignment_kind:'official'};
 let html=render(data);assert.ok(html.includes('Đã công bố'));assert.ok(html.includes('>0</p>'));assert.ok(!html.includes('308'));
 html=render(null,true);assert.ok(html.includes('Đang tải'));html=render(null,false,'Lỗi kết nối');assert.ok(html.includes('Không tải được'));assert.ok(html.includes('Lỗi kết nối'));
 html=render({...data,schedule_status:null,assignment_count:null,shortage_cells:null});assert.ok(html.includes('Chưa lập lịch'));assert.ok(html.includes('Chưa có dữ liệu'));
});
test('manager navigation keeps original routes and adds grouped official schedule entry',()=>{
 const {dashboardConfig}=load('src/dashboard.config.ts',{'lucide-react':new Proxy({},{get:()=>()=>null})});
 const items=dashboardConfig.QL.navigation;assert.equal(new Set(items.map(i=>i.path)).size,items.length);for(const group of ['Tổng quan','Lập lịch làm việc','Vận hành','Quản trị'])assert.ok(items.some(i=>i.group===group));for(const route of ['/manager/schedule','/manager/publish','/manager/registrations','/manager/official-schedule'])assert.ok(items.some(i=>i.path===route));
});
test('official table paginates rows and keeps day filtering independent of persisted assignments',()=>{
 const data={source:'supabase',period:{id:'w'},schedules:[{id:'p',version:1,status:'PUBLISHED',published_at:'date',schedule_group_id:'g'}],employees:[],departments:[{id:'d',name:'Kitchen'}],shifts:[],assignments:Array.from({length:25},(_,i)=>({id:String(i),schedule_id:'p',employee_id:'e',department_id:'d',work_date:i<20?'2026-11-02':'2026-11-03',status:'ACTIVE',shift:{name:'Morning',start_time:'08:00',end_time:'12:00'},employee:{full_name:'Person '+i}}))};
 function render(page,day=''){const states=[[], 'w',data,false,'',0,day,'','','',page];let n=0;const {OfficialSchedule}=load('src/pages/manager/OfficialSchedule.tsx',{react:{...React,useState:()=>[states[n++],()=>{}],useEffect:()=>{}},'react-router-dom':{useSearchParams:()=>[new URLSearchParams(),()=>{}]},'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b'}})},'../../services/scheduling.service':{},'../../services/scheduling.view':{dateLabel:x=>x,weekLabel:()=> 'Week'}});return renderToStaticMarkup(React.createElement(OfficialSchedule));}
 const first=render(0),second=render(1),filtered=render(0,'2026-11-03');
 assert.equal((first.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g)||[]).length,20);
 assert.equal((second.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g)||[]).length,5);
 assert.ok(filtered.includes('5 phân công phù hợp'));assert.ok(!filtered.includes('Person 0</td>'));assert.equal(data.assignments.length,25);
});
