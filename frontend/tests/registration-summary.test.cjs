const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const source=fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}");const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports:{},Intl,Date,AbortSignal,...globals,require(id){return id in overrides?overrides[id]:require(id)}};vm.runInNewContext(code,context);return context.exports;}
const view=load('src/services/scheduling.view.ts');
const demandView=load('src/services/staffing-demand.view.ts');
const row={branch_id:'branch',period_id:'period',work_date:'2026-11-02',shift_id:'shift',shift_name:'Ca sáng',start_time:'08:00:00',end_time:'12:00:00',department_id:'kitchen',department_name:'Bếp',registered_count:3,eligible_count:1,confirmed_eligible_count:1,required_count:2,balance:-1,shortage_count:1,surplus_count:0,status:'SHORTAGE',required_skill_name:'Bếp nóng',exclusions:{},other_department_registered_count:0,warnings:[]};
const rows=[row,{...row,department_id:'cash',department_name:'Thu ngân',status:'SURPLUS',surplus_count:1,shortage_count:0},
  {...row,work_date:'2026-11-03',department_id:'service',department_name:'Phục vụ',status:'UNKNOWN',eligible_count:null,required_count:null,shortage_count:null,surplus_count:null}];
const summary={source:'mock',is_mock:true,branch:{id:'branch',name:'Chi nhánh mô phỏng TV3'},period:{id:'period'},rows,warnings:[{code:'NEW_THRESHOLD_NOT_CONFIGURED',message:'Chưa đủ dữ liệu đánh giá: chưa cấu hình ngưỡng cảnh báo NEW.'}],notes:[]};
function component(react=React,service={}){return load('src/pages/manager/RegistrationSummaryPanel.tsx',{react,'../../services/scheduling.service':{schedulingService:service},'../../services/scheduling.view':view,'../../services/staffing-demand.view':demandView});}
test('summary table separates counts and shows three departments, shortage/surplus/unknown',()=>{
  const {RegistrationSummaryTable}=component();const html=renderToStaticMarkup(React.createElement(RegistrationSummaryTable,{rows}));
  for(const text of ['Bếp','Thu ngân','Phục vụ','Đăng ký VALID','Đủ điều kiện','Nhu cầu','Thiếu người','Thừa ứng viên','Chưa đủ dữ liệu đánh giá','Chưa xác định'])assert.ok(html.includes(text),text);
});
test('summary filters date, shift and department independently and together',()=>{
  const {filterRegistrationRows}=component();assert.equal(filterRegistrationRows(rows,{date:'2026-11-02',shift:'shift',department:'kitchen'}).length,1);
  assert.equal(filterRegistrationRows(rows,{date:'2026-11-02',shift:'',department:''}).length,2);
  assert.equal(filterRegistrationRows(rows,{date:'',shift:'missing',department:''}).length,0);
});
test('summary filters use all configured shifts and seven days, not only registered/demand rows',()=>{
 const data={...summary,period:{id:'period',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08'}},catalog={source:'mock',period:data.period,shifts:[{id:'shift',name:'Ca 1',start_time:'08:00',end_time:'12:00'},{id:'pm',name:'Ca 2',start_time:'12:00',end_time:'17:00'},{id:'late',name:'Ca 3',start_time:'17:00',end_time:'22:00'}],departments:[{id:'kitchen',name:'Bếp'},{id:'cash',name:'Thu ngân'},{id:'service',name:'Phục vụ'}]};
 let index=0;const states=[data,false,'',{date:'2026-11-02',shift:'late',department:''}],hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};
 const {RegistrationSummaryPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0,context:catalog}));
 for(const text of ['Ca 1','Ca 2','Ca 3','08/11/2026','Chưa nhập nhu cầu','Chưa có nhân viên đăng ký'])assert.ok(html.includes(text),text);assert.equal((html.match(/Chưa nhập nhu cầu/g)||[]).length,3);
});
test('mock and unconfigured NEW threshold are explicitly labelled',()=>{
  const states=[summary,false,'',{date:'',shift:'',department:''}];let index=0;
  const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};
  const {RegistrationSummaryPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));
  for(const text of ['Dữ liệu mô phỏng (MOCK)','Không lưu hoặc tạo lịch thật','Chưa đủ dữ liệu đánh giá','Tất cả ngày','Tất cả ca','Tất cả bộ phận'])assert.ok(html.includes(text),text);
  states[0]={...summary,source:'supabase',is_mock:false};index=0;const real=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(real.includes('Dữ liệu Supabase'));assert.ok(!real.includes('Dữ liệu mô phỏng (MOCK)'));
});
test('summary API reuses auth and calls existing period-scoped backend route',async()=>{
  class ApiError extends Error{};let requested;
  const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{requested={url,options};return new Response(JSON.stringify({status:'ok',result:summary}))}}).schedulingService;
  const result=await service.summary('period');assert.equal(result.source,'mock');assert.equal(requested.url,'/api/schedules/periods/period/registrations-summary');assert.equal(requested.options.headers.Authorization,'Bearer fixture');
});

test('loading and API error are displayed without fabricated summary rows',()=>{
  const states=[null,true,'',{date:'',shift:'',department:''}];let index=0;
  const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};
  const {RegistrationSummaryPanel}=component(hooks);
  let html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(html.includes('Đang tổng hợp đăng ký'));assert.ok(!html.includes('Dữ liệu mô phỏng (MOCK)'));
  states[1]=false;states[2]='Không thể đọc dữ liệu Supabase';index=0;
  html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(html.includes('role="alert"'));assert.ok(html.includes('Không thể đọc dữ liệu Supabase'));assert.ok(!html.includes('Ca sáng'));
});
