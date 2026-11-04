import { Link,useSearchParams } from 'react-router-dom';
import { ShiftChanges } from './ShiftChanges';
import './EmployeeWorkspace.css';

export type SupportTab='request'|'incident'|'history';
export function EmployeeSupport({initialTab='request'}:{initialTab?:SupportTab}){
 const [params]=useSearchParams(),requested=params.get('tab');
 const tab:SupportTab=requested==='request'||requested==='incident'||requested==='history'?requested:initialTab;
 const url=(next:SupportTab)=>{const p=new URLSearchParams(params);p.set('tab',next);return '/employee/support?'+p.toString();};
 return <section className="employee-support employee-workspace">
  <nav className="employee-support-tabs" aria-label="Yêu cầu và hỗ trợ">
   {([['request','Đổi ca'],['incident','Báo cáo sự cố'],['history','Lịch sử yêu cầu']] as const).map(([value,label])=><Link key={value} to={url(value)} aria-current={tab===value?'page':undefined}>{label}</Link>)}
  </nav>
  <ShiftChanges key={tab} initialAction={tab==='incident'?'REPORT':'CREATE_REQUEST'} historyOnly={tab==='history'} compact/>
 </section>;
}
