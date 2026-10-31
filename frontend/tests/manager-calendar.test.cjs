const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const period={id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08'};
const data={source:'supabase',period,employees:[{id:'e',full_name:'Nhân viên A',department_id:'d'},{id:'other',full_name:'Nhân viên B',department_id:'other'}],departments:[{id:'d',name:'Bếp'}],shifts:[{id:'s',name:'Ca sáng',start_time:'08:00',end_time:'12:00'}],registrations:[{employee_id:'e',work_date:'2026-11-02',shift_id:'s'}],declarations:[{employee_id:'e',work_date:'2026-11-03',declaration:'OFF'}],schedules:[{id:'saved',version:1,status:'DRAFT',published_at:null}],assignments:[{id:'a',schedule_id:'saved',employee_id:'e',department_id:'d',work_date:'2026-11-02',shift_id:'s',status:'DRAFT',employee:null}]};
function page(tab,department='',person='',value=data){
 const states=[tab,[{...period,schedules:[]}],'p',value,'saved',department,person,false,'',0];let index=0;
 const context={exports:{},require(name){if(name==='react')return {...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}};if(name==='react-router-dom')return {Link:({children})=>React.createElement('a',{},children)};if(name.includes('AuthContext'))return {useAuth:()=>({user:{branch_id:'b',branch_name:'Chi nhánh'}})};if(name.includes('scheduling.service'))return {schedulingService:{}};if(name.includes('scheduling.view'))return {dateLabel:x=>x,weekLabel:()=> '02–08/11',statusLabel:x=>x};if(name.endsWith('.css'))return{};return require(name);}};
 const code=ts.transpileModule(fs.readFileSync('src/pages/manager/ManagerCalendar.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,context);return renderToStaticMarkup(React.createElement(context.exports.ManagerCalendar));
}
test('registration week distinguishes selected shifts, OFF and not submitted with real filters',()=>{
 const html=page('registrations','d','e');assert.match(html,/Lịch đăng ký/);assert.match(html,/OFF/);assert.match(html,/Ca sáng/);assert.match(html,/Chưa gửi hợp lệ/);assert.match(html,/2026-11-08/);assert.doesNotMatch(html,/Nhân viên B/);
});
test('draft is never labelled official; published ACTIVE is explicit; empty assignments stay empty',()=>{
 assert.doesNotMatch(page('assignments'),/>Chính thức</);
 const published=structuredClone(data);published.schedules[0].status='PUBLISHED';published.assignments[0].status='ACTIVE';assert.match(page('assignments','','',published),/>Chính thức</);
 const empty=structuredClone(data);empty.schedules=[];assert.match(page('assignments','','',empty),/Chưa có lịch phân công/);
});
