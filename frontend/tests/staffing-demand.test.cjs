const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const source=fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}");const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports:{},Intl,Date,Map,Set,AbortSignal,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,context);return context.exports;}
const scheduleView=load('src/services/scheduling.view.ts'),demandView=load('src/services/staffing-demand.view.ts');
const grid=load('src/services/staffing-demand.grid.ts',{'./staffing-demand.view':demandView});
const matrix=load('src/pages/manager/StaffingStatusMatrix.tsx',{'../../services/staffing-demand.view':demandView,'../../services/staffing-demand.grid':grid,'../../services/staffing-status.view':load('src/services/staffing-status.view.ts'),'../../services/scheduling.view':scheduleView});
const period={id:'period',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED',schedules:[]};
const requirement={id:'demand',work_date:'2026-11-02',shift_id:'shift',department_id:'kitchen',required_count:2,required_skill_name:'Bếp nóng',sales_forecast_ref:'Forecast tuần 45 – mô phỏng',updated_at:'2026-10-29T00:00:00Z',created_by:'creator'};
const row={branch_id:'branch',period_id:'period',work_date:requirement.work_date,shift_id:'shift',shift_name:'Ca sáng',start_time:'08:00:00',end_time:'12:00:00',department_id:'kitchen',department_name:'Bếp',registered_count:2,eligible_count:1,confirmed_eligible_count:1,required_count:2,balance:-1,shortage_count:1,surplus_count:0,status:'SHORTAGE',required_skill_name:'Bếp nóng',exclusions:{SKILL_MISMATCH:1},other_department_registered_count:0,warnings:[{code:'SKILL_MISMATCH',message:'Có nhân viên không có kỹ năng bắt buộc.'}]};
const data={source:'mock',is_mock:true,branch:{id:'branch',name:'Chi nhánh mô phỏng'},period,requirements:[requirement],departments:[{id:'kitchen',name:'Bếp'},{id:'cash',name:'Thu ngân'},{id:'service',name:'Phục vụ'}],shifts:[{id:'shift',name:'Ca sáng',start_time:'08:00:00',end_time:'12:00:00',is_active:true}],skill_names:['Bếp nóng'],forecast_mode:'REFERENCE_ONLY',staffing_formula_status:'NOT_CONFIGURED',summary:{source:'mock',is_mock:true,branch:{id:'branch',name:'Chi nhánh mô phỏng'},period,rows:[row],warnings:[{code:'NEW_THRESHOLD_NOT_CONFIGURED',message:'Chưa đủ dữ liệu đánh giá: chưa cấu hình ngưỡng NEW.'}],notes:[]}};
function component(react=React,service={},globals={}){return load('src/pages/manager/ManagerDemand.tsx',{
 react,'react-router-dom':{Link:({children,to})=>React.createElement('a',{href:to},children)},'../../context/AuthContext':{useAuth:()=>({user:{branch_id:'branch',branch_name:'Chi nhánh'}})},
 '../../services/scheduling.service':{schedulingService:service},'../../services/scheduling.view':scheduleView,'../../services/staffing-demand.view':demandView,'../../services/staffing-demand.grid':grid,'../../services/staffing-demand.guard':{useUnsavedDemandGuard(){}},'./StaffingStatusMatrix':matrix,
},globals);}
test('/manager/demand has explicit QL route with ManagerDemand, not wildcard placeholder',()=>{
 const source=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
 const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='path'&&p.initializer&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='/manager/demand'))found=node;ts.forEachChild(node,visit)};visit(source);
 assert.ok(found);const route=found.getText(source);assert.ok(route.includes('<ManagerDemand'));assert.ok(route.includes("allowedRoles={['QL']}"));assert.ok(route.includes('<AppLayout>'));assert.ok(!route.includes('PlaceholderPage'));
});
test('demand grid includes all seven days and three departments; missing rows stay UNKNOWN',()=>{
 const days=demandView.demandDays(data);assert.equal(days.length,7);const rows=demandView.demandRows(data);assert.equal(rows.length,21);
 const saved=rows.find(r=>r.work_date===requirement.work_date&&r.department_id==='kitchen');assert.equal(saved.eligible_count,1);assert.equal(saved.required_count,2);
 const missing=rows.find(r=>r.work_date==='2026-11-08'&&r.department_id==='cash');assert.equal(missing.required_count,null);assert.equal(missing.shortage_count,null);assert.equal(missing.status,'UNKNOWN');
});
test('workspace shows manual demand, forecast source, three departments and skill/config warnings',()=>{
 const {DemandWorkspace}=component();const html=renderToStaticMarkup(React.createElement(DemandWorkspace,{data,draft:{},errors:{},saving:false,onChange(){}}));
 for(const text of ['Bếp','Thu ngân','Phục vụ','Số nhân viên cần','Nguồn / ghi chú Sales Forecast','Forecast tuần 45','Tình trạng nhân sự theo ca','đủ điều kiện trước xếp lịch','Chưa đủ dữ liệu đánh giá','Thiếu 1','Sao chép thứ Hai','Ô trống = chưa xác định'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Tính năng này chưa sẵn sàng'));
});
test('weekly grid saves explicit zero with preserved forecast, skills and revision',async()=>{
 let saved;const key=demandView.demandRowKey(requirement);
 await grid.saveGrid(data,{[key]:{count:'0',forecast:'Forecast note'}},{saveDemand:async(_,body)=>{saved=body;return{requirement:{...requirement,...body}}},clearDemand:async()=>assert.fail('zero is not unknown')});
 assert.equal(saved.required_count,0);assert.equal(saved.sales_forecast_ref,'Forecast note');assert.equal(saved.required_skill_name,'Bếp nóng');assert.equal(saved.expected_updated_at,requirement.updated_at);
});
test('demand API uses GET and PUT under existing authenticated scheduling client',async()=>{
 class ApiError extends Error{};const calls=[];
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'ok',result:options.method==='PUT'?{source:'mock',is_mock:true,requirement}:data}))}}).schedulingService;
 await service.demand('period');const body={...requirement,expected_updated_at:requirement.updated_at};delete body.id;delete body.created_by;delete body.updated_at;await service.saveDemand('period',body);
 await service.clearDemand('period',{work_date:body.work_date,shift_id:body.shift_id,department_id:body.department_id,expected_updated_at:body.expected_updated_at});assert.equal(calls[2].options.method,'DELETE');assert.equal(JSON.parse(calls[2].options.body).expected_updated_at,requirement.updated_at);
 assert.equal(calls[0].url,'/api/schedules/periods/period/requirements');assert.equal(calls[1].options.method,'PUT');assert.deepEqual(JSON.parse(calls[1].options.body),body);assert.equal(calls[1].options.headers.Authorization,'Bearer fixture');
});
function interactive(service,globals={}){const states=[],refs=[],effects=[],pending=[];let si=0,ri=0,ei=0,tree;const hooks={...React,
 useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}]},
 useRef(initial){return refs[ri++] ||= {current:initial}},useEffect(callback,deps){const i=ei++;const prev=effects[i];if(!prev||deps.some((v,j)=>!Object.is(v,prev.deps[j]))){prev?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=callback()})}}
 };const mod=component(hooks,service,globals);const find=(node,type)=>{if(!React.isValidElement(node))return null;if(node.type===type)return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,type);if(found)return found;}return null;};
 return{async settle(){for(let i=0;i<8;i++){si=ri=ei=0;tree=mod.ManagerDemand();while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r));}},edit(){const workspace=find(tree,mod.DemandWorkspace);assert.ok(workspace);workspace.props.onChange({[demandView.demandRowKey(requirement)]:{count:'0',forecast:'Forecast note'}})},chooseWeek(id){find(tree,'select').props.onChange({target:{value:id}})},get selectedWeek(){return find(tree,'select').props.value},async save(){const findButton=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&node.props.className.includes('demand-save'))return node;for(const child of React.Children.toArray(node.props.children)){const found=findButton(child);if(found)return found;}return null;};return findButton(tree).props.onClick()},html(){return renderToStaticMarkup(tree)}};
}
test('manager demand saves then GETs refreshed data; errors after successful write never show fake read success',async()=>{
 for(const failRead of [false,true]){const calls=[];let stored=false;
  const page=interactive({periods:async()=>[period],demand:async()=>{calls.push('GET');if(stored&&failRead)throw Error('Read unavailable');return data},saveDemand:async()=>{calls.push('PUT');stored=true;return{requirement}}});
  await page.settle();page.edit();await page.settle();await page.save();await page.settle();
  assert.deepEqual(calls,['GET','PUT','GET']);const html=page.html();
  if(failRead){assert.ok(html.includes('nhưng chưa đọc lại được'));assert.ok(!html.includes('Đã lưu và đọc lại'));}else assert.ok(html.includes('Đã lưu và đọc lại 1 ô'));
 }
});
test('missing active shifts disables demand editing and informs manager',()=>{
 const {DemandWorkspace}=component();const html=renderToStaticMarkup(React.createElement(DemandWorkspace,{data:{...data,shifts:[]},draft:{},errors:{},saving:false,onChange:()=>assert.fail('save disabled')}));
 assert.ok(html.includes('Chưa có ca hoạt động'));assert.ok(!html.includes('data-demand-cell='));
});
test('changing week asks before discarding unsaved cells; cancelling retains the week and edit',async()=>{
 const next={...period,id:'next'},calls=[];let allow=false,prompts=0;
 const page=interactive({periods:async()=>[period,next],demand:async id=>{calls.push(id);return{...data,period:{...period,id}}}},{window:{confirm(){prompts++;return allow}}});
 await page.settle();page.edit();await page.settle();assert.deepEqual(calls,['period']);page.chooseWeek('next');await page.settle();assert.equal(page.selectedWeek,'period');assert.equal(prompts,1);assert.ok(page.html().includes('1 ô chưa lưu'));assert.deepEqual(calls,['period']);
 allow=true;page.chooseWeek('next');await page.settle();assert.equal(page.selectedWeek,'next');assert.deepEqual(calls,['period','next']);assert.ok(!page.html().includes('1 ô chưa lưu'));
});

test('empty/partial demand never claims ready; schedule link preserves loaded week',async()=>{
 for(const requirements of [[],[requirement]]){
  const page=interactive({periods:async()=>[period],demand:async()=>({...data,requirements})});await page.settle();
  const html=page.html();assert.doesNotMatch(html,/sẵn sàng cho Rule Engine/);
  assert.match(html,requirements.length?/Đã lưu 1\/21 ô nhu cầu/:/Chưa nhập nhu cầu nhân sự/);
  assert.match(html,/href="\/manager\/schedule\?period_id=period"/);
 }
 const second={...period,id:'another-week'};const page=interactive({periods:async()=>[period,second],demand:async id=>({...data,period:{...period,id}})});
 await page.settle();page.chooseWeek(second.id);await page.settle();assert.match(page.html(),/href="\/manager\/schedule\?period_id=another-week"/);
});

test('zero is declared demand; pending writes and failed reads never claim readiness',()=>{
 const requirements=grid.gridCells(data).map((c,i)=>({...requirement,...c,id:String(i),required_count:0}));
 const full={...data,requirements};
 assert.match(grid.demandSyncMessage(full,0,false,''),/Đã đồng bộ đầy đủ/);
 assert.match(grid.demandSyncMessage(full,1,false,''),/1 ô chưa lưu/);
 assert.match(grid.demandSyncMessage(full,0,true,''),/Đang lưu/);
 assert.match(grid.demandSyncMessage(full,0,false,'Read failed'),/Cần kiểm tra dữ liệu/);
});
