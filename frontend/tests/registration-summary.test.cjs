const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const source=fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}"),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports:{},Intl,Date,Map,Set,AbortSignal,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,context);return context.exports;}
const dates=load('src/services/scheduling.view.ts'),view=load('src/services/staffing-demand.view.ts'),grid=load('src/services/staffing-demand.grid.ts',{'./staffing-demand.view':view}),status=load('src/services/staffing-status.view.ts');
const matrix=load('src/pages/manager/StaffingStatusMatrix.tsx',{'../../services/scheduling.view':dates,'../../services/staffing-demand.view':view,'../../services/staffing-demand.grid':grid,'../../services/staffing-status.view':status});
const period={id:'period',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08'};
const row={branch_id:'branch',period_id:'period',work_date:'2026-11-02',shift_id:'s1',shift_name:'Ca 1',start_time:'08:00:00',end_time:'12:00:00',department_id:'k',department_name:'Bếp',registered_count:3,eligible_count:1,confirmed_eligible_count:1,required_count:2,balance:-1,shortage_count:1,surplus_count:0,status:'SHORTAGE',required_skill_name:'Bếp nóng',exclusions:{},other_department_registered_count:0,warnings:[]};
function fixture(){return{source:'mock',is_mock:true,branch:{id:'branch',name:'Chi nhánh mô phỏng'},period,rows:[row,{...row,department_id:'t',department_name:'Thu ngân',eligible_count:3,status:'SURPLUS',balance:1,surplus_count:1,shortage_count:0},{...row,department_id:'p',department_name:'Phục vụ',status:'UNKNOWN',eligible_count:null,required_count:null,shortage_count:null,surplus_count:null}],warnings:[{code:'NEW_THRESHOLD_NOT_CONFIGURED',message:'Chưa cấu hình ngưỡng NEW.'}],notes:['Tổng hợp độc lập theo ca.']};}
function catalog(){return{source:'mock',period,shifts:[['s1','08:00','12:00'],['s2','12:00','17:00'],['s3','17:00','22:00']].map(([id,start_time,end_time],i)=>({id,name:'Ca '+(i+1),start_time,end_time})),departments:[{id:'k',name:'Bếp'},{id:'t',name:'Thu ngân'},{id:'p',name:'Phục vụ'}]};}
function component(react=React,service={}){return load('src/pages/manager/RegistrationSummaryPanel.tsx',{react,'../../services/scheduling.service':{schedulingService:service},'./StaffingStatusMatrix':matrix});}
function settled(summary=fixture(),context=catalog()){let index=0;const states=[summary,false,''];const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};const {RegistrationSummaryPanel}=component(hooks);return renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0,context}));}

test('registration panel reuses one shift-status component instead of a duplicate wide supply table',()=>{
 const html=settled();assert.equal((html.match(/class="card staffing-status"/g)||[]).length,1);
 assert.ok(html.includes('Tình trạng nhân sự theo ca'));assert.ok(!html.includes('summary-table'));
 for(const text of ['Bếp','Thu ngân','Phục vụ','1 / 2','3 / 2','Thiếu 1','Dư 1 ứng viên','Chưa thể đánh giá','Xem chi tiết'])assert.ok(html.includes(text),text);
});
test('matching Backend catalog retains all shifts, seven day options and unregistered shifts',()=>{
 const html=settled();assert.equal((html.match(/class="staffing-shift"/g)||[]).length,3);assert.equal((html.match(/<option /g)||[]).length,7);
 for(const text of ['Ca 1','Ca 2','Ca 3','08/11/2026','Chưa nhập nhu cầu','Chưa có nhân viên đăng ký'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Tất cả ca'));assert.ok(!html.includes('Cả tuần'));
});
test('missing or mismatched catalog only uses returned metadata and reports incomplete catalog',()=>{
 for(const context of [null,{...catalog(),source:'supabase'},{...catalog(),period:{...period,id:'another'}}]){
  const html=settled(fixture(),context);assert.equal((html.match(/class="staffing-shift"/g)||[]).length,1);
  assert.ok(html.includes('Chưa có danh mục ca đầy đủ'));assert.ok(!html.includes('Ca 2'));assert.ok(!html.includes('Ca 3'));
 }
});
test('MOCK label and NEW warning remain explicit with warnings once in collapsed supplementary details',()=>{
 const html=settled();assert.ok(html.includes('Dữ liệu mô phỏng (MOCK)'));assert.equal((html.match(/Chưa cấu hình ngưỡng NEW\./g)||[]).length,1);
 assert.match(html,/<details class="staffing-extra">/);assert.ok(html.includes('Tổng hợp độc lập theo ca.'));
 const real=settled({...fixture(),source:'supabase',is_mock:false},{...catalog(),source:'supabase'});
 assert.ok(real.includes('Dữ liệu Supabase'));assert.ok(!real.includes('Dữ liệu mô phỏng (MOCK)'));
});
test('summary API reuses auth and existing period-scoped route',async()=>{
 class ApiError extends Error{};let requested;
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{requested={url,options};return new Response(JSON.stringify({status:'ok',result:fixture()}))}}).schedulingService;
 assert.equal((await service.summary('period')).source,'mock');assert.equal(requested.url,'/api/schedules/periods/period/registrations-summary');assert.equal(requested.options.headers.Authorization,'Bearer fixture');
});
test('loading and API errors never fabricate shifts or display an old period summary',()=>{
 const states=[null,true,''];let index=0;
 const hooks={...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}},{RegistrationSummaryPanel}=component(hooks);
 let html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(html.includes('Đang tổng hợp đăng ký'));assert.ok(!html.includes('staffing-shift'));
 states[1]=false;states[2]='Không thể đọc dữ liệu Supabase';index=0;
 html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(html.includes('role="alert"'));assert.ok(html.includes(states[2]));assert.ok(!html.includes('staffing-shift'));
 states[0]={...fixture(),period:{...period,id:'old'}};index=0;
 html=renderToStaticMarkup(React.createElement(RegistrationSummaryPanel,{periodId:'period',refreshKey:0}));assert.ok(!html.includes('staffing-shift'));
});
test('summary callback still publishes fetched data and ignores disposed requests',async()=>{
 let effect,release;const received=[],hooks={...React,useState:initial=>[initial,()=>{}],useEffect:fn=>effect=fn},data=fixture(),service={summary:()=>new Promise(resolve=>release=resolve)};
 const {RegistrationSummaryPanel}=component(hooks,service);RegistrationSummaryPanel({periodId:'period',refreshKey:0,onSummary:value=>received.push(value)});
 const cleanup=effect();release(data);await new Promise(r=>setImmediate(r));assert.deepEqual(received,[null,data]);cleanup();
 received.length=0;const cleanupNext=effect();cleanupNext();release(data);await new Promise(r=>setImmediate(r));assert.deepEqual(received,[null]);
});
