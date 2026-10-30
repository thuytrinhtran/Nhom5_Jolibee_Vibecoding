const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/services/shift-change.view.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},Intl,Date};vm.runInNewContext(code,context);const view=context.exports;
const start=Date.parse('2026-11-02T14:00:00+07:00'),deadline=new Date(start-3600000).toISOString();
const invitation={id:'i',target_employee_id:'employee',full_name:'Người thay',status:'ACCEPTED',effective_status:'ACCEPTED',expires_at:new Date(start).toISOString(),eligible_now:true};
const request={status:'PENDING',schedule_state:'VALID',original_assignment:{work_date:'2026-11-02'},shift:{name:'Chiều',start_time:'14:00:00',end_time:'22:00:00'},invitations:[invitation]};
test('creation is strictly before T-60 and invitation expires at shift start',()=>{
  assert.equal(view.canCreate(deadline,start-3600001),true);assert.equal(view.canCreate(deadline,start-3600000),false);
  assert.equal(view.invitationState(invitation,start,start-1),'ACCEPTED');assert.equal(view.invitationState(invitation,start,start),'EXPIRED');
  assert.equal(view.invitationState({...invitation,expires_at:deadline},start,start-3600000),'EXPIRED');
});
test('only accepted, eligible, unexpired candidates on open valid schedules can be approved',()=>{
  assert.equal(view.acceptedCandidates(request,start-1).length,1);
  for(const patch of [{status:'APPROVED'},{status:'REJECTED'},{schedule_state:'STALE_PUBLISHED_SCHEDULE'},{schedule_state:'AMBIGUOUS_PUBLISHED_SCHEDULE'}, {invitations:[{...invitation,eligible_now:false}]},{invitations:[{...invitation,status:'PENDING',effective_status:'PENDING'}]}])assert.equal(view.acceptedCandidates({...request,...patch},start-1).length,0);
  assert.equal(view.acceptedCandidates(request,start).length,0);
});
test('employee response uses effective status and current shift start; overnight labels preserve date',()=>{
  const i={...invitation,status:'PENDING',effective_status:'PENDING',assignment:{work_date:'2026-11-02'},start_time:'14:00:00'};
  assert.equal(view.canRespond(i,start-1),true);assert.equal(view.canRespond(i,start),false);
  assert.equal(view.canRespond({...i,effective_status:'EXPIRED'},start-1),false);
  assert.equal(view.startAt('2026-11-02','22:00:00'),Date.parse('2026-11-02T15:00:00Z'));
  assert.match(view.shiftLabel({name:'Đêm',start_time:'22:00:00',end_time:'06:00:00'}),/\(\+1 ngày\)/);
});
test('TV5 routes use existing layout and correct role guards',()=>{
  const app=fs.readFileSync('src/App.tsx','utf8');
  assert.match(app,/path="\/employee\/shift-requests" element=\{<ProtectedRoute allowedRoles=\{\['NV'\]\}><AppLayout><EmployeeShiftRequests/);
  assert.match(app,/path="\/manager\/shift-requests" element=\{<ProtectedRoute allowedRoles=\{\['QL'\]\}><AppLayout><ManagerShiftRequests/);
});

// Render real page components with in-memory hook state; no effects or HTTP are executed.
function renderPage(file,values){
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');let index=0;
  function compile(relative){
    const source=fs.readFileSync('src/'+relative,'utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    const scope={exports:{},Date,require(id){
      if(id==='react')return{...React,useState:initial=>[index<values.length?values[index++]:(typeof initial==='function'?initial():initial),()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:initial=>({current:initial})};
      if(id.includes('AuthContext'))return{useAuth:()=>({user:{id:'actor'},refreshUser:async()=>{}})};
      if(id.includes('auth.service'))return{ApiError:Error};
      if(id.includes('shift-change.service'))return{shiftChangeService:{}};
      if(id.includes('shift-change.view'))return view;
      if(id.includes('ShiftChangeRequestDetails'))return compile('pages/shift-change/ShiftChangeRequestDetails.tsx');
      if(id.endsWith('.css'))return{};return require(id);
    }};vm.runInNewContext(compiled,scope);return scope.exports;
  }
  const page=compile(file);return renderToStaticMarkup(React.createElement(Object.values(page)[0]));
}
const fullRequest={...request,id:'r',requesting_employee_name:'Người yêu cầu',reason:'Bận học',created_at:'2026-11-01T00:00:00Z',resolved_at:null,warning:null,replacement_employee_id:null};
test('employee proposal renders a named candidate selector and no manual identifier input',()=>{
  const a={assignments:[{...request.original_assignment,id:'a',shift:request.shift,request_deadline_at:deadline}],schedule_issues:[]};
  const values=['create',a,[],[],{},false,false,'','','a','Bận học','propose','employee',[{employee_id:'employee',full_name:'Người thay'}],false,'',0,'',start-7200000];
  const html=renderPage('pages/employee/EmployeeShiftRequests.tsx',values);
  assert.ok(html.includes('Người thay được đề xuất'));assert.ok(html.includes('value="employee"'));assert.ok(html.includes('Người thay'));
  assert.ok(!html.includes('type="text"'));assert.ok(!html.includes('UUID'));
});
test('manager details show actual acceptances and disable approval when no eligible acceptance remains',()=>{
  const values=[[fullRequest],false,false,'','','','','r','employee','',start-1];
  let html=renderPage('pages/manager/ManagerShiftRequests.tsx',values);
  assert.ok(html.includes('Người yêu cầu'));assert.ok(html.includes('Người thay'));assert.ok(html.includes('Duyệt người đã chọn'));
  assert.ok(!/disabled=""[^>]*>Duyệt người đã chọn/.test(html));
  html=renderPage('pages/manager/ManagerShiftRequests.tsx',[[{...fullRequest,invitations:[{...invitation,eligible_now:false}]}],...values.slice(1)]);
  assert.match(html,/disabled=""[^>]*>Duyệt người đã chọn/);
});
test('employee empty and failed states are distinct',()=>{
  const base=['requests',null,[],null,{},false,false,'','','','','auto','',[],false,'',0,'',start-1];
  assert.ok(renderPage('pages/employee/EmployeeShiftRequests.tsx',base).includes('Bạn chưa gửi yêu cầu'));
  const failed=[...base];failed[2]=null;failed[4]={requests:'Không thể kết nối'};
  const html=renderPage('pages/employee/EmployeeShiftRequests.tsx',failed);
  assert.ok(html.includes('Không thể kết nối'));assert.ok(!html.includes('Bạn chưa gửi yêu cầu'));
});
