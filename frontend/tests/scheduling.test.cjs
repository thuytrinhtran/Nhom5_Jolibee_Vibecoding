const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
function load(file,overrides={},globals={}){
  const source=fs.readFileSync(file,'utf8').replace('import.meta.env',JSON.stringify({VITE_API_URL:'http://api.test/api/'}));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const context={exports:{},AbortSignal,Intl,Date,...globals,require(id){if(id==='../../services/staffing-demand.guard')return{useUnsavedDemandGuard:()=>{}};if(id==='./PreviewCandidates')return{PreviewCandidates:()=>null};if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id);}};
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

test('calendar groups seven days with only the first open, preserves 21 shifts and uses four-column tables',()=>{
 const data=threeShiftContext(),{ScheduleTable}=page(),html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved}));
 assert.equal((html.match(/<details class="schedule-day"/g)||[]).length,7);
 assert.equal((html.match(/<details class="schedule-day" open=""/g)||[]).length,1);
 assert.equal((html.match(/class="schedule-shift-table"/g)||[]).length,21);
 assert.equal((html.match(/<th scope="col">/g)||[]).length,84);
 assert.equal((html.match(/<th scope="row">/g)||[]).length,63);
 assert.ok(html.includes('Dữ liệu thử nghiệm · MOCK'));
 assert.ok(html.includes('schedule-employee-chips'));
 assert.ok(!html.includes('schedule-row-short'));
});

test('day totals count repeated employee assignments and identify partial unknown demand without claiming full coverage',()=>{
 const data=threeShiftContext();data.requirements.push({...context.requirements[0],id:'pm',shift_id:'real-shift-b',required_count:1});
 const schedule={...saved,assignments:[assignment,{...assignment,id:'pm-assignment',shift_id:'real-shift-b'},{...assignment,id:'replaced',status:'REPLACED'},{...assignment,id:'leader',assignment_source:'CREW_LEADER'}],generation_snapshot:{coverage:data.requirements}};
 const before=JSON.stringify({data,schedule}),{ScheduleTable}=page(),html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved:schedule}));
 const firstSummary=html.match(/<details class="schedule-day" open=""><summary>([\s\S]*?)<\/summary>/)[1];
 assert.match(firstSummary,/<b>2<\/b> lượt đã xếp/);
 assert.match(firstSummary,/<b>2<\/b> lượt còn thiếu đã biết/);
 assert.ok(firstSummary.includes('7<!-- --> ô chưa có nhu cầu')||firstSummary.includes('7 ô chưa có nhu cầu'));
 assert.ok(html.includes('Tổng thiếu chưa đầy đủ'));
 assert.equal(JSON.stringify({data,schedule}),before);
});

test('saved zero demand stays zero, missing demand stays unknown, and unsaved demand never claims enough staff',()=>{
 const data=threeShiftContext(),{ScheduleTable}=page();
 const zero={...saved,assignments:[],generation_snapshot:{coverage:[{...context.requirements[0],required_count:0}]}};
 const html=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved:zero}));
 assert.match(html,/aria-label="Đã xếp 0, cần 0"/);assert.equal((html.match(/Đủ người/g)||[]).length,1);
 assert.match(html,/aria-label="Đã xếp 0, cần chưa xác định"/);assert.ok(html.includes('Chưa thể đánh giá'));
 const unsaved=renderToStaticMarkup(React.createElement(ScheduleTable,{context:data,saved:null}));
 assert.ok(!unsaved.includes('Đủ người'));assert.ok(!unsaved.includes('badge-yellow'));assert.ok(unsaved.includes('Chưa có phân công'));
});

test('NEW notices are collapsed but changed-demand warning stays outside supplementary details',()=>{
 const schedule={...saved,demand_changed:true,generation_snapshot:{new_employee_count_threshold:null,coverage:[{...context.requirements[0],warning:'MANY_NEW_WITHOUT_CREW_TRAINING'}]}};
 const states=[[period],'period',context,schedule,false,false,false,'','',0,null];let index=0;
 const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{},useRef:()=>({current:0})};
 const {ManagerSchedule}=page(hooks),html=renderToStaticMarkup(React.createElement(ManagerSchedule));
 const additional=html.match(/<details class="schedule-additional">([\s\S]*?)<\/details>/)?.[1];
 assert.ok(additional?.includes('chưa có ngưỡng cảnh báo NEW'));
 assert.ok(additional.includes('không có Crew Training'));
 assert.match(html,/<div class="schedule-info schedule-demand-changed" role="status">Nhu cầu đã thay đổi/);
 assert.ok(!additional.includes('Nhu cầu đã thay đổi'));
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

function interactivePage(api,browser) {
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
  },{crypto:require('node:crypto').webcrypto,requestAnimationFrame:fn=>fn(),document:{querySelector:()=>null},...(browser?{window:browser}:{})});
  return {
    find(predicate){const visit=node=>{if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=visit(child);if(found)return found;}return null;};return visit(tree);},
    states,
    async settle(){for(let i=0;i<8;i++){stateIndex=refIndex=effectIndex=0;tree=ManagerSchedule();while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r));}},
    html(){return renderToStaticMarkup(tree);},
    generate(){const visit=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&React.Children.toArray(node.props.children).some(c=>c==='Tạo lịch dự kiến'))return node;for(const child of React.Children.toArray(node.props.children)){const found=visit(child);if(found)return found;}return null;};const button=visit(tree);assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();},
  };
}

test('review sends both edited assignments, retains rejected edits and updates only accepted plan',async()=>{
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Saving disabled'}};
 const calls=[];let reject=true;
 const page=interactivePage({periods:async()=>[period],context:async()=>context,preview:async(id,edit)=>{if(!edit)return value;calls.push(edit);if(reject)throw new ApiError('Phân công không có nhu cầu hoặc vượt số người cần.',422,'DEMAND_EXCEEDED');return {...value,result:{...value.result,assignments:edit.assignments}};}});
 await page.settle();page.generate();await page.settle();
 const two=[{...assignment,employee_id:'first'},{...assignment,employee_id:'second'}];page.states[11].assignments=two;page.states[11].dirty=true;await page.settle();
 const clickReview=()=>{const b=page.find(n=>n.type==='button'&&n.props.children==='Kiểm tra lại phương án');assert.ok(b);assert.equal(b.props.disabled,false);b.props.onClick();};
 clickReview();await page.settle();assert.equal(calls[0].assignments.length,2);assert.deepEqual(calls[0].assignments.map(a=>a.employee_id),['first','second']);assert.equal(calls[0].input_revision,'revision');assert.equal(page.states[11].preview,value);assert.equal(page.states[11].assignments,two);assert.equal(page.states[11].dirty,true);
 assert.ok(page.html().includes('Phân công vượt nhu cầu'));assert.ok(page.find(n=>n.props.role==='alert'),'review error remains visible above all tabs');
 reject=false;page.states[11].assignments=[assignment];await page.settle();clickReview();await page.settle();assert.equal(page.states[11].dirty,false);assert.equal(page.states[11].preview.result.assignments.length,1);assert.ok(page.html().includes('Đã kiểm tra và xác nhận phương án điều chỉnh'));
});

test('stale review retains working assignments and blocks AI/save instead of discarding edits',async()=>{
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:true,reason:'Ready'}};
 const p=interactivePage({periods:async()=>[period],context:async()=>context,preview:async(id,body)=>{if(body?.assignments)throw new ApiError('Nguồn thay đổi',409,'PREVIEW_STALE');return value},savePreview:()=>assert.fail('stale must not save')});
 await p.settle();p.generate();await p.settle();const edited=[{...assignment,employee_id:'changed'}];p.states[11].assignments=edited;p.states[11].dirty=true;
 await p.settle();p.find(n=>n.type==='button'&&n.props.children==='Kiểm tra lại phương án').props.onClick();await p.settle();
 assert.equal(p.states[11].assignments,edited);assert.equal(p.states[11].preview,value);assert.equal(p.states[11].dirty,true);
 assert.equal(p.find(n=>n.type==='button'&&n.props.children==='Lưu DRAFT').props.disabled,true);
 
 assert.equal(p.find(n=>n.props.previewDirty!==undefined).props.previewDirty,true);
});

test('regenerate reload and changing week require confirmation and cancellation preserves unified editor',async()=>{
 let previews=0,reads=0,confirmations=0;
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Disabled'}};
 const p=interactivePage({periods:async()=>[period,{...period,id:'next'}],context:async()=>{reads++;return context},preview:async()=>{previews++;return value}},{confirm:()=>{confirmations++;return false}});
 await p.settle();p.generate();await p.settle();const prior=p.states[11],count=reads;
 p.find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Đề xuất lại')).props.onClick();await p.settle();
 p.find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Tải lại tuần')).props.onClick();await p.settle();
 p.find(n=>n.type==='select'&&n.props.id==='schedule-week').props.onChange({target:{value:'next'}});await p.settle();
 assert.equal(confirmations,3);assert.equal(previews,1);assert.equal(reads,count);assert.equal(p.states[11],prior);assert.equal(p.states[1],'period');
});

test('calendar exposes experience warning, total hours and actual optimization trace',()=>{
 const {ScheduleTable,ScheduleStatistics}=page();
 const trace={initial:{employee_id:'employee',reason:'INITIAL_SELECTION'},replacements:[{iteration:1,from_employee_id:'employee',to_employee_id:'employee',from_hours_before:20,to_hours_before:0,shift_hours:4,objective_before:100,objective_after:50}]};
 const data={...saved,assignments:[{...assignment,reason:'LOCAL_SEARCH_REPLACEMENT',selection_history:trace}],generation_snapshot:{coverage:[{...context.requirements[0],assigned_count:1,missing_count:2,experienced_target:2,experienced_count:1,missing_experienced_count:1}],notes:[],employee_statistics:[{employee_id:'employee',shift_count:1,total_weekly_hours:16}],optimization:{iterations:1,converged:true,before:{objective:100},after:{objective:50}}}};
 const html=renderToStaticMarkup(React.createElement(ScheduleTable,{context,saved:data}))+renderToStaticMarkup(React.createElement(ScheduleStatistics,{context,result:data.generation_snapshot}));
 for(const text of ['Kinh nghiệm: 1/2','Thiếu 1 người kinh nghiệm','Giờ tuần: 16','Chọn ban đầu','Dấu vết phân công','100.00','50.00','Tổng giờ làm'])assert.ok(html.includes(text),text);
});

test('coverage totals include server-confirmed existing assignments without inventing new employee chips',()=>{
 const data={...saved,generation_snapshot:{coverage:[{...context.requirements[0],assigned_count:3,missing_count:0,existing_count:2}],notes:[]}};
 const rows=views.scheduleRows(context,data);assert.equal(rows[0].assigned_count,3);assert.equal(rows[0].assignments.length,1);assert.equal(rows[0].missing_count,0);
});
test('manager previews without saving or reading a new database schedule',async()=>{
 const calls=[];const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Saving disabled'}};
 const page=interactivePage({periods:async()=>[period],context:async()=>context,preview:async id=>{calls.push(id);return value},generate:()=>assert.fail('write'),read:()=>assert.fail('read fabricated schedule')});
 await page.settle();page.generate();await page.settle();assert.deepEqual(calls,['period']);const html=page.html();assert.ok(html.includes('Lịch dự kiến — chưa lưu'));assert.ok(html.includes('Lưu DRAFT'));assert.ok(html.includes('disabled'));assert.ok(!html.includes('Mã lịch:'));assert.ok(html.includes('Kiểm tra lại phương án'));
});

test('preview client sends only period and explicit review input to dedicated endpoint',async()=>{
 const calls=[];const mod=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>({}),getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({status:'ok',result:{kind:'preview',persisted:false}})};}});
 await mod.schedulingService.preview('period');await mod.schedulingService.preview('period',{input_revision:'revision',assignments:[]});
 assert.ok(calls.every(c=>c.url.endsWith('/schedules/preview')&&c.options.method==='POST'));
 assert.deepEqual(JSON.parse(calls[0].options.body),{period_id:'period'});assert.deepEqual(JSON.parse(calls[1].options.body),{period_id:'period',input_revision:'revision',assignments:[]});
});

test('reopening a week restores existing database schedule without POST',async()=>{
  let reads=0;const page=interactivePage({periods:async()=>[{...period,schedules:[saved.schedule]}],context:async()=>context,
    generate:async()=>assert.fail('must not generate on load'),read:async id=>{assert.equal(id,'saved');reads++;return saved},
  });await page.settle();assert.equal(reads,1);assert.ok(page.html().includes('Nguyễn An'),'day view renders assigned employees directly');page.find(n=>typeof n.props.onSelect==='function'&&n.props.context).props.onSelect('2026-11-02/shift/dept');await page.settle();assert.ok(page.html().includes('Nguyễn An'));assert.ok(page.html().includes('Bản nháp'));
});
test('failed preview reports error without claiming persistence',async()=>{
 const page=interactivePage({periods:async()=>[period],context:async()=>context,preview:async()=>{throw new ApiError('Preview unavailable',503)}});
 await page.settle();page.generate();await page.settle();const html=page.html();assert.ok(html.includes('role="alert"'));assert.ok(!html.includes('Mã lịch:'));
});

test('all mock contexts allow memory-only draft generation',()=>{
  const state=[[period],'period',{...context,source:'mock'},null,false,false,false,'','',0];let index=0;
  const hooks={...React,useState:()=>[state[index++],()=>{}],useEffect:()=>{},useRef:()=>({current:0})};
  const {ManagerSchedule}=page(hooks);const html=renderToStaticMarkup(React.createElement(ManagerSchedule));
  assert.ok(html.includes('lịch chỉ lưu trong bộ nhớ'));assert.ok(!/<button[^>]*disabled=""[^>]*>.*?Tạo lịch dự kiến/s.test(html));
});

test('manual replacement and removal update only a server-reviewed preview without saving',async()=>{
 const data={...context,employees:[...context.employees,{...context.employees[0],id:'second',full_name:'Nguyễn Bình'}],requirements:[{...context.requirements[0],required_count:1}]};
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context:data,result:{assignments:[assignment],coverage:data.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Saving disabled'}};
 const calls=[];const p=interactivePage({periods:async()=>[period],context:async()=>data,preview:async(id,edit)=>{if(!edit)return value;calls.push(edit);return {...value,result:{...value.result,assignments:edit.assignments}};},savePreview:()=>assert.fail('No automatic save')});
 await p.settle();p.generate();await p.settle();
 p.find(n=>n.type==='button'&&n.props.children==='Tìm người thay').props.onClick();await p.settle();
 await p.find(n=>n.props.requirementId!==undefined).props.onConfirm('second');await p.settle();
 assert.equal(calls.length,1);assert.equal(calls[0].assignments[0].employee_id,'second');assert.equal(p.states[11].dirty,false);assert.equal(p.states[11].preview.result.assignments[0].employee_id,'second');
 p.find(n=>n.type==='button'&&n.props.children==='Bỏ phân công').props.onClick();await p.settle();assert.equal(p.states[11].assignments.length,0);assert.equal(p.states[11].dirty,false);assert.equal(calls.length,2);
});

test('manual move sends destination to Rule Engine and retains last confirmed preview on rejection',async()=>{
 const data={...context,shifts:[...context.shifts,{id:'pm',name:'Ca chiều',start_time:'13:00:00',end_time:'18:00:00'}],requirements:[...context.requirements,{...context.requirements[0],id:'pm-need',shift_id:'pm'}]};
 const initial={kind:'preview',persisted:false,input_revision:'revision',period,context:data,result:{assignments:[assignment],coverage:data.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:true,reason:'Ready'}};
 let reject=true,reviews=0;
 const p=interactivePage({periods:async()=>[period],context:async()=>data,preview:async(id,edit)=>{if(!edit)return initial;reviews++;assert.equal(edit.assignments.length,1);assert.equal(edit.assignments[0].shift_id,'pm');if(reject)throw new ApiError('Nhân viên chưa đăng ký hợp lệ cho ca chiều.',422,'REGISTRATION_REQUIRED');return {...initial,result:{...initial.result,assignments:edit.assignments}};},savePreview:()=>assert.fail('Moving must not save')});
 await p.settle();p.generate();await p.settle();
 p.find(n=>n.type==='select'&&n.props['aria-label']?.startsWith('Chuyển ca cho')).props.onChange({target:{value:'pm-need'}});await p.settle();
 p.find(n=>n.type==='button'&&n.props.children==='Chuyển ca').props.onClick();await p.settle();assert.equal(p.states[11].preview,initial);assert.equal(p.states[11].assignments[0].shift_id,'shift');assert.match(p.html(),/chưa đăng ký hợp lệ/);
 reject=false;p.find(n=>n.type==='button'&&n.props.children==='Chuyển ca').props.onClick();await p.settle();assert.equal(reviews,2);assert.equal(p.states[11].preview.result.assignments[0].shift_id,'pm');assert.equal(p.states[11].dirty,false);
});

test('confirmed preview saves exact reviewed assignments then rereads; failed read retains retry id',async()=>{
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:true,reason:'Ready'}};
 const persisted={...saved,schedule:{...saved.schedule,period_id:period.id}};let failRead=true;const calls=[];
 const page=interactivePage({periods:async()=>[period],context:async()=>context,preview:async()=>value,savePreview:async(id,body,target)=>{calls.push({id,body,target});return{id:'saved'}},read:async()=>{if(failRead)throw new ApiError('Read unavailable',503);return persisted;}});
 await page.settle();page.generate();await page.settle();const click=()=>{const b=page.find(n=>n.type==='button'&&n.props.children==='Lưu DRAFT');assert.equal(b.props.disabled,false);b.props.onClick();};
 click();await page.settle();assert.equal(page.states[11].preview,value);assert.ok(page.html().includes('Đã lưu DRAFT nhưng chưa đọc lại được'));assert.equal(calls[0].body.assignments.length,1);assert.equal(calls[0].body.assignments[0].status,undefined);
 failRead=false;click();await page.settle();assert.equal(calls[0].body.request_id,calls[1].body.request_id);assert.equal(page.states[11].preview,null);assert.equal(page.states[3],persisted);assert.equal(page.find(n=>n.type==='button'&&n.props.children==='Tạo lịch').props['aria-pressed'],true);assert.ok(page.html().includes('Đã lưu bản nháp'));assert.ok(page.html().includes('Chỉnh sửa DRAFT đã lưu'));
});

test('DRAFT edit opens saved assignments and uses versioned PATCH persistence',async()=>{
 const persisted={...saved,schedule:{...saved.schedule,period_id:period.id}};let request;
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],edit_target:{id:'saved',version:1},persistence:{enabled:true,reason:'Ready'}};
 const page=interactivePage({periods:async()=>[{...period,schedules:[persisted.schedule]}],context:async()=>context,read:async()=>persisted,preview:async(id,body)=>{request=body;return value}});await page.settle();page.find(n=>n.type==='button'&&n.props.children==='Chỉnh sửa DRAFT đã lưu').props.onClick();await page.settle();assert.equal(request.schedule_id,'saved');assert.equal(request.expected_version,1);assert.equal(request.use_saved_assignments,true);assert.equal(page.states[11].preview.edit_target.id,'saved');
});

test('planner summarizes cells instead of mounting every employee and opens only the selected cell',()=>{
 const {PlannerBoard}=page(),data=threeShiftContext();
 const props={context:data,saved,preview:null,edited:[],selectedCell:'',onSelect(){},day:'',onDay(){}};
 const before=JSON.stringify(data),html=renderToStaticMarkup(React.createElement(PlannerBoard,props));
 assert.equal((html.match(/class="planner-cell[ "]/g)||[]).length,63);assert.ok(!html.includes('Nguyễn An'));assert.ok(!html.includes('Chi tiết ô lịch'));
 const panel=renderToStaticMarkup(React.createElement(PlannerBoard,{...props,selectedCell:'2026-11-02/shift/dept'}));
 assert.ok(panel.includes('Chi tiết ô lịch'));assert.ok(panel.includes('Nguyễn An'));assert.ok(panel.includes('Đã xếp 1 / Cần 3'));assert.equal(JSON.stringify(data),before);
});

test('planner pending selections never present stale coverage or experience as validated',()=>{
 const {PlannerBoard}=page(),coverage=[{...context.requirements[0],assigned_count:9,missing_count:0,experienced_count:0,experienced_target:2,missing_experienced_count:2}];
 const preview={result:{assignments:[assignment],coverage}};
 const html=renderToStaticMarkup(React.createElement(PlannerBoard,{context,saved:null,preview,edited:[],dirty:true,selectedCell:'',onSelect(){},day:'2026-11-02',onDay(){}}));
 assert.ok(html.includes('Đã xếp <b>0</b> / Cần <b>3</b>'));assert.ok(html.includes('Chờ kiểm tra'));assert.ok(!html.includes('Đủ người'));assert.ok(!html.includes('Thiếu 2 kinh nghiệm'));assert.ok(!html.includes('Đã xếp <b>9</b>'));
});

test('planner filters only presentation and keeps saved zero distinct from undeclared demand',()=>{
 const {PlannerBoard}=page(),data=threeShiftContext();
 const zero={...saved,generation_snapshot:{coverage:[{...context.requirements[0],required_count:0}]}};
 const html=renderToStaticMarkup(React.createElement(PlannerBoard,{context:data,saved:zero,preview:null,edited:[],selectedCell:'',onSelect(){},day:'2026-11-02',onDay(){}}));
 assert.equal((html.match(/class="planner-department"/g)||[]).length,9);assert.ok(html.includes('Đã xếp <b>1</b> / Cần <b>0</b>'));assert.ok(html.includes('Vượt 1'));assert.ok(html.includes('Chưa có nhu cầu'));
});

test('planner progress never equates approval with publication',()=>{
 const {PlannerProgress}=page();
 const approved=renderToStaticMarkup(React.createElement(PlannerProgress,{periodStatus:'CLOSED',scheduleStatus:'APPROVED',hasPreview:false}));
 assert.ok(approved.includes('Đã duyệt'));assert.ok(approved.includes('Chưa công bố'));assert.ok(!approved.includes('Đã công bố'));
 const published=renderToStaticMarkup(React.createElement(PlannerProgress,{periodStatus:'CLOSED',scheduleStatus:'PUBLISHED',hasPreview:false}));assert.equal((published.match(/class="is-complete"/g)||[]).length,4);
});

test('day view renders employee names, levels, shift times and actionable vacancies directly',()=>{
 const {PlannerBoard}=page(),data={...context,employees:[{...context.employees[0],skill_level:'REGULAR'}]};
 const preview={result:{assignments:[assignment],coverage:context.requirements}};
 const before=JSON.stringify(data),html=renderToStaticMarkup(React.createElement(PlannerBoard,{context:data,saved:null,preview,edited:[],selectedCell:'',onSelect(){},day:'2026-11-02',onDay(){}}));
 for(const text of ['Ca sáng','08:00','12:00','Bếp','Nguyễn An','Có kinh nghiệm','Đã xếp <b>1</b> / Cần <b>3</b>','Vị trí trống 1','Vị trí trống 2','Tìm nhân viên phù hợp'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('planner-matrix'));assert.equal(JSON.stringify(data),before);
 const published=renderToStaticMarkup(React.createElement(PlannerBoard,{context:data,saved:{...saved,schedule:{...saved.schedule,status:'PUBLISHED'}},preview:null,edited:[],selectedCell:'',onSelect(){},day:'2026-11-02',onDay(){}}));
 assert.ok(published.includes('Nguyễn An'));assert.ok(!published.includes('Tìm nhân viên phù hợp'));assert.ok(!published.includes('Điều chỉnh phân công'));
});

test('weekly cell click opens its day and selected position without altering the plan',()=>{
 const hooks={...React,useState:()=>['',()=>{}],useEffect(){},useRef:()=>({current:null})};const {PlannerBoard}=page(hooks),events=[];
 const tree=PlannerBoard({context,saved,preview:null,edited:[],selectedCell:'',onSelect:key=>events.push(['cell',key]),day:'',onDay:day=>events.push(['day',day])});
 const visit=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&node.props.className?.startsWith('planner-cell'))return node;for(const child of React.Children.toArray(node.props.children)){const result=visit(child);if(result)return result;}return null;};
 const button=visit(tree);assert.ok(button);button.props.onClick({currentTarget:{}});assert.deepEqual(events,[['day','2026-11-02'],['cell','2026-11-02/shift/dept']]);
});

test('switching planner tabs retains reviewed manual changes without further data reads or saving',async()=>{
 let reads=0,previews=0;const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:true,reason:'Ready'}};
 const p=interactivePage({periods:async()=>{reads++;return[period]},context:async()=>{reads++;return context},preview:async(id,edit)=>{previews++;return edit?{...value,result:{...value.result,assignments:edit.assignments}}:value;},savePreview:()=>assert.fail('Tabs must not save')});
 await p.settle();p.generate();await p.settle();
 p.find(n=>n.type==='button'&&n.props.children==='Tìm người thay').props.onClick();await p.settle();await p.find(n=>n.props.requirementId!==undefined).props.onConfirm('changed');await p.settle();const working=p.states[11],count=reads;
 for(const label of ['Tạo lịch','Phân công nhân viên','Tạo lịch','Phân công nhân viên']){p.find(n=>n.type==='button'&&n.props.children===label).props.onClick();await p.settle();assert.equal(p.states[11],working);}
 assert.equal(p.states[11].assignments[0].employee_id,'changed');assert.equal(p.find(n=>n.props.previewDirty!==undefined).props.previewDirty,false);assert.equal(p.find(n=>n.type==='button'&&n.props.children==='Lưu DRAFT').props.disabled,false);assert.equal(reads,count);assert.equal(previews,2);
});

test('published planner is read-only and AI is advisory with no proposal application handler',async()=>{
 const published={...saved,schedule:{...saved.schedule,status:'PUBLISHED'}};
 const p=interactivePage({periods:async()=>[{...period,schedules:[published.schedule]}],context:async()=>context,read:async()=>published,preview:()=>assert.fail('Published must not generate')});
 await p.settle();assert.equal(p.find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Tạo lịch dự kiến')).props.disabled,true);assert.equal(p.find(n=>n.type==='select'&&n.props.id==='preview-employee-0'),null);
 assert.equal(p.find(n=>typeof n.props.onApplied==='function'),null);assert.ok(p.html().includes('Lịch đã công bố chỉ để xem'));assert.ok(!p.find(n=>n.props.autoEvaluate===true));
});

test('changing week clears the selected cell and date filter while preserving the selected tab',async()=>{
 const next={...period,id:'next',work_start_date:'2026-11-09',work_end_date:'2026-11-15'};
 const p=interactivePage({periods:async()=>[period,next],context:async id=>id==='next'?{...context,period:next,requirements:context.requirements.map(r=>({...r,work_date:'2026-11-09'}))}:context});
 await p.settle();p.find(n=>n.type==='button'&&n.props.children==='Phân công nhân viên').props.onClick();await p.settle();
 let board=p.find(n=>typeof n.props.onSelect==='function'&&n.props.context);board.props.onDay('2026-11-02');board.props.onSelect('2026-11-02/shift/dept');await p.settle();
 p.find(n=>n.type==='select'&&n.props.id==='schedule-week').props.onChange({target:{value:'next'}});await p.settle();
 board=p.find(n=>typeof n.props.onSelect==='function'&&n.props.context);assert.equal(board.props.context.period.id,'next');assert.equal(board.props.day,'2026-11-09');assert.equal(board.props.selectedCell,'');assert.equal(p.find(n=>n.type==='button'&&n.props.children==='Phân công nhân viên').props['aria-pressed'],true);
});

test('suggestion cell action selects exact day/shift/department and preserves reviewed assignments',async()=>{
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Disabled'}};
 const p=interactivePage({periods:async()=>[period],context:async()=>context,preview:async()=>value,savePreview:()=>assert.fail('Navigation never saves')});
 await p.settle();p.generate();await p.settle();const before=p.states[11];const need=context.requirements[0],key=`${need.work_date}/${need.shift_id}/${need.department_id}`;
 p.find(n=>typeof n.props.onOpenCell==='function').props.onOpenCell(key);await p.settle();const board=p.find(n=>typeof n.props.onSelect==='function'&&n.props.context);
 assert.equal(board.props.day,need.work_date);assert.equal(board.props.selectedCell,key);assert.equal(p.states[11],before);assert.equal(p.find(n=>n.props.requirementId!==undefined).props.requirementId,need.id);
});

test('disabled DRAFT persistence explains its reason and cannot invoke the writer',async()=>{
 const value={kind:'preview',persisted:false,input_revision:'revision',period,context,result:{assignments:[assignment],coverage:context.requirements,shortages:[],notes:[]},warnings:[],persistence:{enabled:false,reason:'Kỳ này chưa được phép lưu lịch.'}};
 const p=interactivePage({periods:async()=>[period],context:async()=>context,preview:async()=>value,savePreview:()=>assert.fail('Disabled persistence must never write')});
 await p.settle();p.generate();await p.settle();assert.ok(p.html().includes(value.persistence.reason));const save=p.find(n=>n.type==='button'&&n.props.children==='Lưu DRAFT');assert.equal(save.props.disabled,true);save.props.onClick();await p.settle();assert.equal(p.states[11].preview,value);
});
