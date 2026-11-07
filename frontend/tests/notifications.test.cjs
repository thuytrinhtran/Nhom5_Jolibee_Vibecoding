const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function harness(){
 const state=[],slots=[],pending=[],calls=[];let cursor=0,effect=0;
 const hooks={...React,useState(initial){const n=cursor++;if(!(n in state))state[n]=initial;return[state[n],v=>state[n]=typeof v==='function'?v(state[n]):v];},useEffect(fn,deps){const n=effect++,old=slots[n];if(!old||deps.some((v,i)=>old.deps[i]!==v)){old?.cleanup?.();slots[n]={deps};pending.push(()=>slots[n].cleanup=fn());}}};
 const window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
 const box={exports:{},window,Date,Error,require:id=>id==='react'?hooks:id==='../../services/auth.service'?{authorized:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))}:require(id)};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/layout/NotificationList.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,box);
 return {state,calls,render(userId){cursor=effect=0;return box.exports.NotificationList({userId});},effects(){for(const fn of pending.splice(0))fn();},close(){for(const slot of slots)slot.cleanup?.();}};
}
const flush=()=>new Promise(setImmediate);
test('notification list discards previous account responses and clears data on failure',async()=>{
 const h=harness();h.render('first');h.effects();h.render('second');h.effects();
 h.calls[1].resolve({result:[{id:'second'}]});await flush();assert.equal(h.state[0][0].id,'second');
 h.calls[0].resolve({result:[{id:'first'}]});await flush();assert.equal(h.state[0][0].id,'second');
 h.render('third');h.effects();assert.equal(h.state[0].length,0);h.calls[2].reject(Error('offline'));await flush();
 assert.equal(h.state[1],false);assert.equal(h.state[2],true);assert.equal(h.state[0].length,0);h.close();
});
test('notification list does not update after closing',async()=>{
 const h=harness();h.render('first');h.effects();h.close();h.calls[0].resolve({result:[{id:'late'}]});await flush();assert.equal(h.state[0].length,0);
});
