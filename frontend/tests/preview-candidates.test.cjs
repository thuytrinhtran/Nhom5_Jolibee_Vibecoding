const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function harness(candidates,previewValue={period:{id:'p'}}){
 let tree,si=0,ei=0,disabled=false,confirmed=[],checked=[];const states=[],effects=[],pending=[];
 const hooks={...React,useState(initial){const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect(callback,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=callback());}}};
 const source=ts.transpileModule(fs.readFileSync('src/pages/manager/PreviewCandidates.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const box={exports:{},Error,require:id=>id==='react'?hooks:id==='../../services/scheduling.service'?{schedulingService:{candidates}}:require(id)};vm.runInNewContext(source,box);
 const preview=previewValue;
 function find(type,predicate=()=>true,node=tree){if(!React.isValidElement(node))return null;if(node.type===type&&predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const value=find(type,predicate,child);if(value)return value;}return null;}
 return {confirmed,checked,find,html:()=>renderToStaticMarkup(tree),set disabled(v){disabled=v},async settle(){for(let i=0;i<4;i++){si=ei=0;tree=box.exports.PreviewCandidates({preview,requirementId:'n',disabled,onConfirm:id=>confirmed.push(id),onChecked:result=>checked.push(result)});while(pending.length)pending.shift()();await new Promise(r=>setImmediate(r));}}};
}
test('contact confirmation is required before assigning and edits invalidate candidates',async()=>{
 const h=harness(async()=>[{id:'e',full_name:'Employee',skill_level:'REGULAR',phone:'0900000000',availability:'Registered'}]);await h.settle();
 assert.ok(h.html().includes('0900000000'));assert.equal(h.find('button').props.disabled,true);
 h.find('input',n=>n.props.type==='radio').props.onChange();await h.settle();assert.equal(h.find('button').props.disabled,true);
 h.find('input',n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});await h.settle();assert.equal(h.find('button').props.disabled,false);
 h.find('button').props.onClick();assert.deepEqual(h.confirmed,['e']);
 h.disabled=true;await h.settle();assert.equal(h.find('button'),null);assert.ok(!h.html().includes('0900000000'));
});
test('late candidate response is discarded after edits and read errors preserve the plan',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>finish=resolve));await h.settle();h.disabled=true;await h.settle();finish([{id:'late',full_name:'Stale employee'}]);await h.settle();assert.ok(!h.html().includes('Stale employee'));assert.deepEqual(h.confirmed,[]);
 const failed=harness(async()=>{throw Error('Read unavailable');});await failed.settle();assert.ok(failed.html().includes('Read unavailable'));assert.equal(failed.find('button').props.disabled,true);
});

test('filled positions do not claim missing staff or query additional contacts',async()=>{
 const h=harness(()=>assert.fail('Full position does not need extra staff'),{period:{id:'p'},result:{coverage:[{id:'n',assigned_count:2,required_count:2}]}});
 await h.settle();assert.match(h.html(),/đủ số lượng/);assert.ok(!h.html().includes('chi viện'));assert.equal(h.find('button'),null);
});

test('only completed candidate API reads publish counts, including verified empty results',async()=>{
 const h=harness(async()=>[{id:'a',skill_level:'REGULAR'},{id:'b',skill_level:'NEW'}]);await h.settle();assert.equal(h.checked.length,1);assert.equal(h.checked[0].count,2);assert.equal(h.checked[0].experiencedCount,1);
 const empty=harness(async()=>[]);await empty.settle();assert.equal(empty.checked.length,1);assert.equal(empty.checked[0].count,0);
 const failed=harness(async()=>{throw Error('Unavailable')});await failed.settle();assert.equal(failed.checked.length,0);
 let finish;const late=harness(()=>new Promise(r=>finish=r));await late.settle();late.disabled=true;await late.settle();finish([]);await late.settle();assert.equal(late.checked.length,0);
});
