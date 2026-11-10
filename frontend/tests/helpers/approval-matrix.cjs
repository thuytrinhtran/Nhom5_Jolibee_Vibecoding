const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(name,overrides={}){
 const source=fs.readFileSync(path.join(__dirname,'../../src/pages/schedules',name+'.ts'+(name==='ApprovalAssignmentMatrix'?'x':'')),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const box={exports:{},require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};if(id==='./approvalMatrix.view')return load('approvalMatrix.view');return require(id);}};
 vm.runInNewContext(code,box);return box.exports;
}
module.exports={...load('ApprovalAssignmentMatrix'),load};
