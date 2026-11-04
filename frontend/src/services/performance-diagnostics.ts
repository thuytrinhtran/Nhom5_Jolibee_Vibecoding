// Local opt-in diagnostics: no request bodies, headers, tokens or extra API calls.
const enabled=import.meta.env.DEV&&import.meta.env.VITE_PERFORMANCE_DIAGNOSTICS==='true';
const routes:{path:string;start:number;end?:number;commits:number;render_ms:number;max_render_ms:number}[]=[];
export function notePerformanceRoute(path:string){
 if(!enabled||routes[routes.length-1]?.path===path)return;const now=performance.now();if(routes.length)routes[routes.length-1].end=now;
 routes.push({path,start:now,commits:0,render_ms:0,max_render_ms:0});if(routes.length>50)routes.shift();
}
export function recordPerformanceRender(_id:string,_phase:string,duration:number){
 if(!enabled)return;const r=routes[routes.length-1];if(r){r.commits++;r.render_ms+=duration;r.max_render_ms=Math.max(r.max_render_ms,duration);}
}
export function installPerformanceDiagnostics(){
 if(!enabled)return;let lcp=0;try{new PerformanceObserver(list=>{const entries=list.getEntries();lcp=entries[entries.length-1]?.startTime??lcp;}).observe({type:'largest-contentful-paint',buffered:true});}catch{/* Browser may not implement LCP. */}
 const snapshot=()=>{
  const resources=performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const safe=(name:string)=>{try{return new URL(name).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id');}catch{return'unknown';}};
  return{captured_at:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight},paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:e.startTime})),lcp_ms:lcp,
   routes:routes.map(r=>({...r,requests:resources.filter(e=>e.startTime>=r.start&&e.startTime<(r.end??Infinity)&&e.name.includes('/api/')).map(e=>({path:safe(e.name),ms:e.duration,bytes:e.transferSize}))}))};
 };
 (window as unknown as Record<string,unknown>).__jolliShiftPerformance={snapshot,download:()=>{const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jollishift-browser-performance.json';a.click();URL.revokeObjectURL(url);}};
}
