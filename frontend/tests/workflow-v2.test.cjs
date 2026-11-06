const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('publication deadline explains disabled controls and rejects past/invalid input',()=>{
 const code=ts.transpileModule(fs.readFileSync('src/pages/schedules/ScheduleWorkflow.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},require(id){if(id==='react')return React;if(id==='react/jsx-runtime')return (id==='../../components/Toast'?require('./helpers/ui-components.cjs'):require(id));return{};}};vm.runInNewContext(code,box);
 const validate=box.exports.publicationDeadlineError,now=Date.parse('2026-11-03T00:00:00Z');
 assert.match(validate('',now),/Nhập thời hạn/);assert.match(validate('invalid',now),/tương lai/);
 assert.match(validate('2026-11-02T00:00:00Z',now),/tương lai/);assert.equal(validate('2026-11-04T00:00:00Z',now),null);
});
test('supervisor inspection renders server coverage, experience warnings and readable cell labels',()=>{
 const result={ready:true,workflow_enabled:false,labels:{shifts:{s:'Morning'},departments:{d:'Kitchen'}},validation:{hard_constraints:'PASS',issues:[],warnings:[{message:'One experienced employee missing'}],coverage:[{id:'c',work_date:'2026-11-02',shift_id:'s',department_id:'d',assigned_count:2,required_count:2,experienced_count:1,experienced_target:2,missing_count:0,missing_experienced_count:1}]}};
 let n=0;const hooks={...React,useState:()=>[n++===0?result:'',()=>{}],useEffect:()=>{}};
 const code=ts.transpileModule(fs.readFileSync('src/pages/schedules/ScheduleWorkflow.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime')return (id==='../../components/Toast'?require('./helpers/ui-components.cjs'):require(id));if(id.endsWith('.css'))return{};return{};}};vm.runInNewContext(code,box);
 const html=renderToStaticMarkup(React.createElement(box.exports.WorkflowInspection,{scheduleId:'s',service:{reviewSchedule:()=>{throw Error('No SSR effect')}}}));
 for(const text of ['Đạt','Morning','Kitchen','2/2','1/2','One experienced employee missing'])assert.ok(html.includes(text),text);
 assert.equal(html.includes('<button'),false,'inspection cannot itself mutate state');
});
