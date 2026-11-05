// Capture isolated HTML fixtures at an exact CSS viewport. Never accesses the app session.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
async function main(){
 const browser=process.argv[2];if(!browser||!path.isAbsolute(browser)||!fs.existsSync(browser))throw Error('Provide existing Chrome/Edge executable path');
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jolli-employee-layout-')),out=process.argv[3]?path.resolve(process.argv[3]):path.resolve(__dirname,'../../docs/employee-ui-20261103');
 const pages=process.argv[4]?process.argv[4].split(','):['calendar','request','incident'];if(pages.some(p=>!/^[a-z]+$/.test(p)))throw Error('Invalid page name');
 const child=spawn(browser,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile],{windowsHide:true,stdio:'ignore'});
 let ws;try{
  let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!port)throw Error('Browser startup timeout');
  const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Browser command timeout'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
  await call('Page.enable');const results=[];
  for(const width of [1366,390])for(const name of pages){
   await call('Emulation.setDeviceMetricsOverride',{width,height:768,deviceScaleFactor:1,mobile:false});
   await call('Page.navigate',{url:pathToFileURL(path.join(out,name+'.html')).href});
   await call('Runtime.evaluate',{expression:"new Promise(r=>{const done=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)));if(document.readyState==='complete')done();else addEventListener('load',done,{once:true});})",awaitPromise:true});
   const result=await call('Runtime.evaluate',{expression:"JSON.stringify({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,navigation_overflow:(()=>{const n=document.querySelector('.app-navigation');return n?n.scrollHeight>n.clientHeight:null;})(),planner_cells:document.querySelectorAll('.planner-cell').length,panel_members:document.querySelectorAll('.planner-members>li').length})",returnByValue:true});
   results.push({page:name,...JSON.parse(result.result.value),static_snapshot:true});
   const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,`${name}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  fs.writeFileSync(path.join(out,'layout-results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
 }finally{ws?.close();child.kill();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
