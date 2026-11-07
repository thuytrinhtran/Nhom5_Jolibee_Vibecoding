const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const tools={skillLevels:{NEW:{label:'New'},REGULAR:{label:'Experienced'}},employeeCompetencyService:{list:async()=>[]}};
function load(deps={}){
 const code=ts.transpileModule(fs.readFileSync('src/pages/manager/OfficialSchedule.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const defaults={react:React,'react-router-dom':{},'../../context/AuthContext':{},'../../services/scheduling.service':{},'../../services/scheduling.view':{dateLabel:x=>x,weekLabel:p=>p.work_start_date},'../../services/employee-competency.service':tools};
 const box={exports:{},Date,Error,require:id=>id in deps?deps[id]:id in defaults?defaults[id]:id.endsWith('.css')?{}:require(id)};vm.runInNewContext(code,box);return box.exports;
}
const period={id:'w',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08'};
const schedule={id:'p',schedule_group_id:'g',version:1,status:'PUBLISHED',published_at:'2026-11-01',created_at:'2026-11-01'};
const assignment=i=>({id:'a'+i,employee_id:'e'+i,schedule_id:'p',status:'ACTIVE',work_date:'2026-11-02',shift_id:'s',department_id:'d',employee:{id:'e'+i,full_name:'Person '+i},shift:{id:'s',name:'Morning',start_time:'08:00',end_time:'12:00'}});
const fixture=(rows=[])=>({period,schedules:[schedule],assignments:rows,departments:[{id:'d',name:'Kitchen'}],employees:[],shifts:[],source:'supabase'});
test('loader reads every API page and keeps metadata from the first page',async()=>{
 const {loadOfficialWeek}=load(),rows=Array.from({length:201},(_,i)=>assignment(i)),calls=[];
 const result=await loadOfficialWeek('w',async(id,f)=>{calls.push(f);return {...fixture(rows.slice(f.page*100,(f.page+1)*100)),departments:f.metadata?[{id:'d',name:'Kitchen'}]:[],total:201,metadata_included:f.metadata};});
 assert.equal(calls.length,3);assert.equal(result.assignments.length,201);assert.equal(result.assignments.at(-1).id,'a200');assert.equal(result.departments[0].name,'Kitchen');assert.equal(calls[1].metadata,false);
});
test('known page count loads in bounded parallel batches and preserves page order',async()=>{
 const {loadOfficialWeek}=load(),rows=Array.from({length:601},(_,i)=>assignment(i));
 let active=0,max=0;const pending=[];
 const promise=loadOfficialWeek('w',async(id,f)=>{
  if(f.page){active++;max=Math.max(max,active);await new Promise(resolve=>pending.push(resolve));active--;}
  return {...fixture(rows.slice(f.page*100,(f.page+1)*100)),total:601};
 });
 await new Promise(setImmediate);assert.equal(pending.length,4);pending.splice(0).reverse().forEach(resolve=>resolve());
 await new Promise(setImmediate);assert.equal(pending.length,2);pending.splice(0).reverse().forEach(resolve=>resolve());
 const result=await promise;assert.equal(max,4);assert.equal(result.assignments.length,601);assert.equal(result.assignments.at(-1).id,'a600');
});
test('loader rejects mixed publication versions, duplicate assignments and incomplete responses',async()=>{
 const {loadOfficialWeek}=load(),rows=Array.from({length:101},(_,i)=>assignment(i));
 await assert.rejects(loadOfficialWeek('w',async(id,f)=>({...fixture(rows.slice(f.page*100,(f.page+1)*100)),schedules:[{...schedule,version:f.page?2:1}],total:101})),/Tải lại/);
 await assert.rejects(loadOfficialWeek('w',async()=>({...fixture([assignment(0),assignment(0)]),total:2})),/Tải lại/);
 await assert.rejects(loadOfficialWeek('w',async(id,f)=>({...fixture(f.page?[]:rows.slice(0,100)),total:101})),/Tải lại/);
});
test('cancelled week stops loading further pages; shift durations handle overnight',async()=>{
 const {loadOfficialWeek,officialShiftHours,officialDays}=load();let calls=0;
 await assert.rejects(loadOfficialWeek('w',async()=>{calls++;return {...fixture(Array.from({length:100},(_,i)=>assignment(i))),total:200};},()=>false));assert.equal(calls,1);
 assert.equal(officialShiftHours('20:00','02:00'),6);assert.equal(officialShiftHours('08:00','12:30'),4.5);assert.equal(officialDays('2026-12-28').at(-1),'2027-01-03');
});
test('timeline shows all employees in one shift, current levels and no draft/replaced names',()=>{
 const {OfficialTimeline}=load(),rows=Array.from({length:30},(_,i)=>assignment(i));rows.push({...assignment(50),status:'REPLACED'},{...assignment(51),schedule_id:'draft',status:'DRAFT'});
 const html=renderToStaticMarkup(React.createElement(OfficialTimeline,{data:fixture(rows),day:'2026-11-02',department:'d',levels:{e0:'REGULAR'}}));
 assert.ok(html.includes('Person 29'));assert.ok(!html.includes('Person 50'));assert.ok(!html.includes('Person 51'));assert.ok(html.includes('Experienced'));assert.ok(html.includes('4 giờ'));assert.ok(html.includes('08:00'));assert.ok(html.includes('22:00'));assert.equal((html.match(/class="official-shift"/g)||[]).length,1);assert.ok(!html.includes('<table'));
});
test('week is the default; selecting a day focuses its heading and filters locally without API calls',async()=>{
 const states=[],refs=[],effects=[],pending=[];let si=0,ri=0,ei=0,calls=0,focused=0;
 const hooks={...React,useState(initial){const n=si++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return [states[n],v=>states[n]=typeof v==='function'?v(states[n]):v];},useRef(initial){return refs[ri++]??=( {current:initial});},useEffect(fn,deps){const n=ei++,old=effects[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){old?.cleanup?.();effects[n]={deps};pending.push(()=>effects[n].cleanup=fn());}}};
 const week={...period,schedules:[schedule]},data=fixture([assignment(0)]);
 const {OfficialSchedule}=load({react:hooks,'react-router-dom':{useSearchParams:()=>[new URLSearchParams(),()=>{}]},'../../context/AuthContext':{useAuth:()=>({user:{id:'u',branch_id:'b'}})},'../../services/scheduling.service':{schedulingService:{periods:async()=>[week],officialCalendar:async()=>{calls++;return {...data,total:1};}}}});
 const render=()=>{si=ri=ei=0;return OfficialSchedule();};let tree;
 const settle=async()=>{for(let i=0;i<8;i++){tree=render();for(const fn of pending.splice(0))fn();await new Promise(setImmediate);}};
 const walk=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(walk)];
 await settle();assert.ok(renderToStaticMarkup(tree).includes('Tổng quan tuần'));assert.equal(calls,1);refs[1].current={focus(){focused++;}};
 walk(tree).find(n=>n.type==='button'&&n.props.children==='2026-11-02').props.onClick();await settle();assert.equal(calls,1);assert.equal(focused,1);assert.ok(renderToStaticMarkup(tree).includes('Person 0'));
 walk(tree).find(n=>n.type==='button'&&n.props.children==='Toàn tuần').props.onClick();await settle();assert.equal(calls,1);assert.ok(renderToStaticMarkup(tree).includes('Tổng quan tuần'));
});
test('retained calendar is labelled while revalidating and never reused after mutation epoch changes',async()=>{
 let states=[],refs=[],effects=[],pending=[],si=0,ri=0,ei=0,epoch=0,hold=false,tree;const reads=[];
 const hooks={...React,useState(initial){const n=si++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v];},useRef(initial){return refs[ri++]??={current:initial};},useEffect(fn,deps){const n=ei++,old=effects[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){old?.cleanup?.();effects[n]={deps};pending.push(()=>effects[n].cleanup=fn());}}};
 const data={...fixture([assignment(0)]),total:1};
 const {OfficialSchedule}=load({react:hooks,'react-router-dom':{useSearchParams:()=>[new URLSearchParams(),()=>{}]},'../../context/AuthContext':{useAuth:()=>({user:{id:'cache-user',branch_id:'b'}})},'../../services/scheduling.service':{schedulingService:{readEpoch:()=>epoch,periods:async()=>[{...period,schedules:[schedule]}],officialCalendar:async()=>hold?new Promise(resolve=>reads.push(resolve)):data}}});
 const settle=async()=>{for(let i=0;i<8;i++){si=ri=ei=0;tree=OfficialSchedule();for(const fn of pending.splice(0))fn();await new Promise(setImmediate);}};
 const remount=()=>{for(const e of effects)e.cleanup?.();states=[];refs=[];effects=[];pending=[];};
 await settle();assert.ok(renderToStaticMarkup(tree).includes('Tổng quan tuần'));
 hold=true;remount();await settle();assert.ok(renderToStaticMarkup(tree).includes('Đang cập nhật lịch mới nhất'));assert.ok(renderToStaticMarkup(tree).includes('Tổng quan tuần'));
 epoch++;remount();await settle();assert.ok(renderToStaticMarkup(tree).includes('Đang tải đầy đủ'));assert.ok(!renderToStaticMarkup(tree).includes('Tổng quan tuần'));
 reads[0](data);await settle();assert.ok(!renderToStaticMarkup(tree).includes('Tổng quan tuần'),'old request cannot overwrite current view');
 reads[1](data);await settle();assert.ok(renderToStaticMarkup(tree).includes('Tổng quan tuần'));
});
