const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('supervisor inspection renders server coverage, experience warnings and readable cell labels',()=>{
 const result={ready:true,workflow_enabled:false,labels:{shifts:{s:'Morning'},departments:{d:'Kitchen'}},validation:{hard_constraints:'PASS',issues:[],warnings:[{message:'One experienced employee missing'}],coverage:[{id:'c',work_date:'2026-11-02',shift_id:'s',department_id:'d',assigned_count:2,required_count:2,experienced_count:1,experienced_target:2,missing_count:0,missing_experienced_count:1}]}};
 let n=0;const hooks={...React,useState:()=>[n++===0?result:'',()=>{}],useEffect:()=>{}};
 const code=ts.transpileModule(fs.readFileSync('src/pages/schedules/ScheduleWorkflow.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime')return require(id);if(id.endsWith('.css'))return{};return{};}};vm.runInNewContext(code,box);
 const html=renderToStaticMarkup(React.createElement(box.exports.WorkflowInspection,{scheduleId:'s',service:{reviewSchedule:()=>{throw Error('No SSR effect')}}}));
 for(const text of ['PASS','Morning','Kitchen','2/2','1/2','One experienced employee missing'])assert.ok(html.includes(text),text);
 assert.equal(html.includes('<button'),false,'inspection cannot itself mutate state');
});
