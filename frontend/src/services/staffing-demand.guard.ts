import { useEffect, useRef } from 'react';
export const UNSAVED_DEMAND_MESSAGE='Bạn có nhu cầu chưa lưu. Rời trang sẽ bỏ các thay đổi này. Tiếp tục?';
// BrowserRouter has no data-router blocker. Guard this workspace's links, unload and back/forward.
export function installDemandGuard(win:Window,doc:Document,isDirty:()=>boolean) {
  let index=win.history.state?.idx as number|undefined,restoring=false;
  const unload=(event:BeforeUnloadEvent)=>{if(isDirty()){event.preventDefault();event.returnValue='';}};
  const click=(event:MouseEvent)=>{
    if(!isDirty()||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;
    if(!(anchor instanceof HTMLAnchorElement)||anchor.download||anchor.target&&anchor.target!=='_self')return;
    const next=new URL(anchor.href,win.location.href);
    if(next.origin!==win.location.origin||next.pathname===win.location.pathname&&next.search===win.location.search)return;
    if(!win.confirm(UNSAVED_DEMAND_MESSAGE)){event.preventDefault();event.stopPropagation();}
  };
  const pop=(event:PopStateEvent)=>{
    if(restoring){restoring=false;event.stopImmediatePropagation();return;}
    const next=event.state?.idx as number|undefined;
    if(isDirty()&&!win.confirm(UNSAVED_DEMAND_MESSAGE)&&index!==undefined&&next!==undefined&&index!==next){
      event.stopImmediatePropagation();restoring=true;win.history.go(index-next);return;
    }
    index=next;
  };
  win.addEventListener('beforeunload',unload);win.addEventListener('popstate',pop,true);doc.addEventListener('click',click,true);
  return ()=>{win.removeEventListener('beforeunload',unload);win.removeEventListener('popstate',pop,true);doc.removeEventListener('click',click,true);};
}
export function useUnsavedDemandGuard(dirty:boolean) {
  const ref=useRef(dirty);ref.current=dirty;
  useEffect(()=>installDemandGuard(window,document,()=>ref.current),[]);
}
