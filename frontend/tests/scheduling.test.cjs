const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
function load(file,overrides={},globals={}){
  const source=fs.readFileSync(file,'utf8').replace('import.meta.env',JSON.stringify({VITE_API_URL:'http://api.test/api/'}));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const context={exports:{},AbortSignal,Intl,Date,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id);}};
  vm.runInNewContext(code,context);return context.exports;
}
const views=load('src/services/scheduling.view.ts');
const period={id:'period',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED',schedules:[]};
const context={period,valid_registration_count:1,employees:[{id:'employee',full_name:'Nguyễn An',department_id:'dept'}],shifts:[{id:'shift',name:'Ca sáng',start_time:'08:00:00',end_time:'12:00:00'}],departments:[{id:'dept',name:'Bếp'}],requirements:[{id:'need',work_date:'2026-11-02',shift_id:'shift',department_id:'dept',required_count:3,required_skill_name:null}]};
const assignment={employee_id:'employee',work_date:'2026-11-02',shift_id:'shift',department_id:'dept',status:'DRAFT',assignment_source:'REGULAR'};
const saved={schedule:{id:'saved',status:'DRAFT',version:1},assignments:[assignment],generation_snapshot:{coverage:context.requirements}};
function page(react=React){return load('src/pages/manager/ManagerSchedule.tsx',{
  './RegistrationSummaryPanel':{RegistrationSummaryPanel:()=>null},
  './ScheduleReviewPanel':{ScheduleReviewPanel:()=>null},'./MockDraftEditor':{MockDraftEditor:()=>null},'./ScheduleAIPanel':{ScheduleAIPanel:()=>null},
  react,'react-router-dom':{Link:({children})=>React.createElement('a',{},children),useSearchParams:()=>[new URLSearchParams(),()=>{}]},
  '../../context/AuthContext':{useAuth:()=>({user:{branch_id:'branch',branch_name:'Chi nhánh thử nghiệm'}})},
  '../../services/auth.service':{ApiError},'../../services/scheduling.service':{schedulingService:{}},'../../services/scheduling.view':views,
});}
test('persisted table displays dates, shift times, names, department, demand and shortage',()=>{
  const {ScheduleTable}=page();const html=renderToStaticMarkup(React.createElement(ScheduleTable,{context,saved}));
  for(const text of ['Ca sáng','08:00','12:00','Nguyễn An','Bếp','Thiếu 2','Phân công đã lưu'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('Tính năng này chưa sẵn sàng'));
});
test('coverage uses persisted assignments, ignores replaced/Crew Leader and preserves original demand snapshot',()=>{
  const modified={...saved,assignments:[assignment,{...assignment,status:'REPLACED'},{...assignment,assignment_source:'CREW_LEADER'}]};
  const changedContext={...context,requirements:[{...context.requirements[0],required_count:99}]};
  const row=views.scheduleRows(changedContext,modified)[0];assert.equal(row.required_count,3);assert.equal(row.assigned_count,1);assert.equal(row.missing_count,2);
});
function threeShiftContext(){return {...context,source:'mock',requirements:context.requirements.map(r=>({...r})),shifts:[['real-shift-c','Ca 3','17:00:00','22:00:00'],['shift','Ca 1','08:00:00','12:00:00'],['real-shift-b','Ca 2','12:00:00','17:00:00']].map(([id,name,start_time,end_time])=>({id,name,start_time,end_time,is_active:true})),departments:[{id:'dept',name:'Bếp'},{id:'cash',name:'Thu ngân'},{id:'service',name:'Phục vụ'}]};}
test('saved calendar displays all 21 configured shifts even if demand/assignments only exist in Ca 1',()=>{
 const data=threeShiftContext(),before=JSON.stringify({data,saved}),rows=views.scheduleCalendarRows(data,saved);
 assert.equal(rows.length,63);assert.equal(new Set(rows.map(r=>`${r.work_date}/${r.shift_id}`)).size,21);
 for(const date of ['2026-11-02','2026-11-08'])assert.equal(new Set(rows.filter(r=>r.work_date===date).map(r=>r.shift_id)).size,3);
 const empty=rows.find(r=>r.work_date==='2026-11-02'&&r.shift_id==='real-shift-b'&&r.department_id==='dept');assert.equal(empty.requirement_id,null);assert.equal(empty.required_count,null);assert.equal(empty.missing_count,null);assert.equal(empty.assignments.length,0);
 const summary={source:'mock',branch:{id:'branch'},period,rows:[{work_date:'2026-11-02',shift_id:'shift',registered_count:1}]};const {ScheduleTable}=page(),html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved,summary}));
 for(const text of ['Ca 1','Ca 2','Ca 3','12:00 – 17:00','17:00 – 22:00','Chưa có nhân viên đăng ký','Chưa nhập nhu cầu','Chưa thể đánh giá','Nguyễn An'])assert.ok(html.includes(text),text);
 assert.equal(JSON.stringify({data,saved}),before);
});
test('empty week calendar still exposes 21 shifts and never converts missing demand into zero',()=>{
 const data={...threeShiftContext(),requirements:[]},rows=views.scheduleCalendarRows(data,null);assert.equal(rows.length,63);assert.ok(rows.every(r=>r.required_count===null&&r.missing_count===null));
 const {ScheduleTable}=page(),html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved:null}));assert.ok(html.includes('Ca 3'));assert.ok(html.includes('Chưa nhập nhu cầu'));assert.ok(!html.includes('Đủ người'));assert.ok(!html.includes('Chưa có nhân viên đăng ký'),'cannot claim zero registrations before summary is loaded');
});
test('calendar preserves saved zero, historical demand and assignment when catalog or current demand changed',()=>{
 const data=threeShiftContext(),historical={...saved,generation_snapshot:{coverage:[{...context.requirements[0],required_count:0},{id:'old-need',work_date:'2026-11-02',shift_id:'retired',department_id:'old-dept',required_count:1,required_skill_name:null}]},assignments:[assignment,{...assignment,id:'historical',shift_id:'retired',department_id:'old-dept'}]};
 const current={...data,requirements:[{...context.requirements[0],required_count:99}]},rows=views.scheduleCalendarRows(current,historical);
 assert.equal(rows.find(r=>r.requirement_id==='need').required_count,0);assert.equal(rows.find(r=>r.requirement_id==='need').current_required_count,99);assert.equal(rows.find(r=>r.requirement_id==='old-need').assignments.length,1);
 const orphan=views.scheduleCalendarRows({...data,requirements:[]},{...saved,generation_snapshot:null,assignments:[{...assignment,shift_id:'unknown-shift'}]});assert.equal(orphan.find(r=>r.shift_id==='unknown-shift').assignments.length,1);assert.equal(orphan.find(r=>r.shift_id==='unknown-shift').required_count,null);
});
test('new demand added after draft is labelled current-only; inactive shifts do not remove saved history',()=>{
 const data=threeShiftContext();data.requirements.push({...context.requirements[0],id:'new',shift_id:'real-shift-b',required_count:2});
 const {ScheduleTable}=page(),html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved}));assert.ok(html.includes('Chưa có nhu cầu trong phiên bản này'));assert.ok(html.includes('Nhu cầu hiện tại: 2'));assert.equal(views.scheduleRows(data,saved)[0].required_count,3);
 data.shifts.find(s=>s.id==='shift').is_active=false;assert.ok(views.scheduleCalendarRows(data,saved).some(r=>r.requirement_id==='need'));
});
test('page exposes selector and draft-only action; empty demand and registrations have explicit notices',()=>{
  // Render a settled page using controlled hook state; no browser/database fixtures are created.
  const state=[[period],'period',context,null,false,false,false,'','',0];let index=0;
  const hooks={...React,useState:()=>[state[index++],()=>{}],useEffect:()=>{},useRef:()=>({current:0})};
  const {ManagerSchedule}=page(hooks);const html=renderToStaticMarkup(React.createElement(ManagerSchedule));
  for(const text of ['Tuần cần lập lịch','Tạo lịch dự kiến','Tải lại tuần','Nhân sự yêu cầu','Đã phân công','Còn thiếu'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('Tính năng này chưa sẵn sàng'));
  state[2]={...context,valid_registration_count:0,requirements:[]};index=0;
  const empty=renderToStaticMarkup(React.createElement(ManagerSchedule));
  assert.ok(empty.includes('Chưa có đăng ký ca hợp lệ'));assert.ok(empty.includes('Chưa khai báo nhu cầu nhân sự'));assert.match(empty,/<button[^>]*disabled=""[^>]*>.*?Tạo lịch dự kiến/s);
});
test('existing schedule selection is stable by version and creation time',()=>{
  assert.equal(views.latestSchedule({...period,schedules:[{id:'old',version:1,created_at:'2026-10-01'},{id:'new',version:2,created_at:'2026-10-02'}]}).id,'new');
});
test('client uses authenticated real API paths, sends period_id and reads saved schedule separately',async()=>{
  const calls=[];let authChecks=0;
  const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{authChecks++},getStoredToken:()=> 'test-token'}}},{fetch:async(url,options)=>{
    calls.push({url,options});const data=url.endsWith('/generate')?{result:{schedule:{id:'saved'}},reused:false}:url.endsWith('/periods')?{periods:[period]}:url.endsWith('/periods/period')?{result:context}:{result:saved};
    return new Response(JSON.stringify({status:'ok',...data}));
  }}).schedulingService;
  await service.periods();await service.context('period');const created=await service.generate('period');const read=await service.read(created.id);
  assert.equal(read.schedule.id,'saved');assert.equal(calls.length,4);assert.equal(authChecks,4);
  assert.deepEqual(calls.map(c=>c.url),['http://api.test/api/schedules/periods','http://api.test/api/schedules/periods/period','http://api.test/api/schedules/generate','http://api.test/api/schedules/saved']);
  assert.deepEqual(JSON.parse(calls[2].options.body),{period_id:'period'});assert.equal(calls[2].options.headers.Authorization,'Bearer test-token');
});
test('API errors, non-JSON and network failures are surfaced without fake success',async()=>{
  for(const fetcher of [async()=>new Response(JSON.stringify({message:'Chưa khai báo nhu cầu nhân sự.',code:'NO_REQUIREMENTS'}),{status:422}),async()=>new Response('<html>bad proxy</html>',{status:502}),async()=>{throw Error('offline')}]){
    const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'test-token'}}},{fetch:fetcher}).schedulingService;
    await assert.rejects(service.generate('period'),e=>e instanceof ApiError&&[422,502,0].includes(e.status));
  }
});

function interactivePage(api) {
  const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0;let tree;
  const pending=[];
  const hooks={...React,
    useState(initial){const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}];},
    useRef(initial){const i=refIndex++;return refs[i] ||= {current:initial};},
    useEffect(callback,deps){const i=effectIndex++;const prior=effects[i];if(!prior||deps.some((value,j)=>!Object.is(value,prior.deps[j]))){prior?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=callback()});}},
  };
  const {ManagerSchedule}=load('src/pages/manager/ManagerSchedule.tsx',{
    './RegistrationSummaryPanel':{RegistrationSummaryPanel:()=>null},
  './ScheduleReviewPanel':{ScheduleReviewPanel:()=>null},'./MockDraftEditor':{MockDraftEditor:()=>null},'./ScheduleAIPanel':{ScheduleAIPanel:()=>null},
    react:hooks,'react-router-dom':{Link:({children})=>React.createElement('a',{},children),useSearchParams:()=>[new URLSearchParams(),()=>{}]},
    '../../context/AuthContext':{useAuth:()=>({user:{branch_id:'branch',branch_name:'Test Branch'}})},
    '../../services/auth.service':{ApiError},'../../services/scheduling.service':{schedulingService:api},'../../services/scheduling.view':views,
  });
  return {
    async settle(){for(let i=0;i<8;i++){stateIndex=refIndex=effectIndex=0;tree=ManagerSchedule();while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r));}},
    html(){return renderToStaticMarkup(tree);},
    generate(){const visit=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&React.Children.toArray(node.props.children).some(c=>c==='Tạo lịch dự kiến'))return node;for(const child of React.Children.toArray(node.props.children)){const found=visit(child);if(found)return found;}return null;};const button=visit(tree);assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();},
  };
}
test('manager creates through API then renders only the separately read persisted schedule',async()=>{
  const calls=[];const page=interactivePage({periods:async()=>[period],context:async()=>context,
    generate:async id=>{calls.push(['POST',id]);return{id:'saved',reused:false}},
    read:async id=>{calls.push(['GET',id]);return saved},
  });
  await page.settle();page.generate();await page.settle();
  assert.deepEqual(calls,[['POST','period'],['GET','saved']]);
  const html=page.html();assert.ok(html.includes('Đã lưu và đọc lại lịch dự kiến'));assert.ok(html.includes('Nguyễn An'));assert.ok(html.includes('Thiếu 2'));
});
test('reopening a week restores existing database schedule without POST',async()=>{
  let reads=0;const page=interactivePage({periods:async()=>[{...period,schedules:[saved.schedule]}],context:async()=>context,
    generate:async()=>assert.fail('must not generate on load'),read:async id=>{assert.equal(id,'saved');reads++;return saved},
  });await page.settle();assert.equal(reads,1);assert.ok(page.html().includes('Nguyễn An'));assert.ok(page.html().includes('Dự kiến'));
});
test('successful write followed by failed read reports recovery, never reports full success',async()=>{
  const page=interactivePage({periods:async()=>[period],context:async()=>context,generate:async()=>({id:'saved',reused:false}),read:async()=>{throw new ApiError('Database unavailable',503)}});
  await page.settle();page.generate();await page.settle();
  const html=page.html();assert.ok(html.includes('Lịch đã được lưu nhưng chưa đọc lại thành công'));assert.ok(!html.includes('Đã lưu và đọc lại lịch dự kiến.'));
});

test('all mock contexts allow memory-only draft generation',()=>{
  const state=[[period],'period',{...context,source:'mock'},null,false,false,false,'','',0];let index=0;
  const hooks={...React,useState:()=>[state[index++],()=>{}],useEffect:()=>{},useRef:()=>({current:0})};
  const {ManagerSchedule}=page(hooks);const html=renderToStaticMarkup(React.createElement(ManagerSchedule));
  assert.ok(html.includes('lịch chỉ lưu trong bộ nhớ'));assert.ok(!/<button[^>]*disabled=""[^>]*>.*?Tạo lịch dự kiến/s.test(html));
});
