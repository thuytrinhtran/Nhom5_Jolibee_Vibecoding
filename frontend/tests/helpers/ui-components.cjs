// Run the real stateless shared UI in the existing TypeScript VM harnesses.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.join(__dirname,'../../src/components/Toast.tsx');
const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const scope={exports:{},require};vm.runInNewContext(output,scope);module.exports=scope.exports;
