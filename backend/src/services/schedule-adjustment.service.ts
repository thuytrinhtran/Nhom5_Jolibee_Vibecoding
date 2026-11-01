import { issueAdjustmentReceipt } from './schedule-adjustment-receipt.js';
﻿import { createHash } from 'node:crypto';
import { inspectPreview } from './schedule-preview.service.js';
import { buildAISummary } from './schedule-ai.summary.js';
import { schedulingAIAdvisor } from './schedule-ai.gemini.js';
import { assignmentIssue, interval, ScheduleError } from './scheduling.engine.js';
import type { SchedulingAIAdvisor } from './scheduling-ai-advisor.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';

const objectives=['BALANCE_HOURS','REDUCE_LOAD','INCREASE_LOAD','PREFER_AVAILABILITY'] as const;
type Limit={kind:'AVOID_DATE'|'PREFER_DATE'|'MAX_WEEKLY_HOURS';employee_code:string|null;date:string|null;value:number|null};
type Parsed={status:'READY'|'NEEDS_CLARIFICATION'|'UNSUPPORTED';objectives:string[];employee_codes:string[];priority:'HIGH'|'NORMAL'|'LOW';limits:Limit[]};
export const ADJUSTMENT_SCHEMA={type:'object',additionalProperties:false,required:['status','objectives','employee_codes','priority','limits'],properties:{
 status:{type:'string',enum:['READY','NEEDS_CLARIFICATION','UNSUPPORTED']},objectives:{type:'array',items:{type:'string',enum:objectives}},employee_codes:{type:'array',items:{type:'string'}},priority:{type:'string',enum:['HIGH','NORMAL','LOW']},limits:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','employee_code','date','value'],properties:{kind:{type:'string',enum:['AVOID_DATE','PREFER_DATE','MAX_WEEKLY_HOURS']},employee_code:{type:['string','null']},date:{type:['string','null']},value:{type:['number','null']}}}}}};
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim();
const invalid=()=>new ScheduleError(502,'AI_INVALID_RESPONSE','AI trả kết quả phân tích không hợp lệ. Chưa thay đổi lịch.');
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function parseAdjustment(value:unknown):Parsed {
 if(!exact(value,['status','objectives','employee_codes','priority','limits'])||!['READY','NEEDS_CLARIFICATION','UNSUPPORTED'].includes(String(value.status))||!['HIGH','NORMAL','LOW'].includes(String(value.priority))||!Array.isArray(value.objectives)||value.objectives.length>4||!value.objectives.every(v=>objectives.includes(v))||!Array.isArray(value.employee_codes)||value.employee_codes.length>70||!value.employee_codes.every(v=>typeof v==='string'&&/^E\d{3}$/.test(v))||!Array.isArray(value.limits)||value.limits.length>10)throw invalid();
 for(const limit of value.limits){if(!exact(limit,['kind','employee_code','date','value'])||!['AVOID_DATE','PREFER_DATE','MAX_WEEKLY_HOURS'].includes(String(limit.kind))||(limit.employee_code!==null&&(typeof limit.employee_code!=='string'||!/^E\d{3}$/.test(limit.employee_code))))throw invalid();
 if(limit.kind==='MAX_WEEKLY_HOURS'){if(limit.date!==null||typeof limit.value!=='number'||!Number.isFinite(limit.value)||limit.value<=0||limit.value>168||limit.employee_code===null)throw invalid();}
 else if(limit.value!==null||typeof limit.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(limit.date)||(!Number.isFinite(Date.parse(limit.date+'T00:00:00Z'))?'INVALID':new Date(limit.date+'T00:00:00Z').toISOString()).slice(0,10)!==limit.date)throw invalid();}
 if(new Set(value.objectives).size!==value.objectives.length||new Set(value.employee_codes).size!==value.employee_codes.length||(value.status==='READY'&&!value.objectives.length))throw invalid();
 return value as unknown as Parsed;
}
// Conservative vocabulary gate: raw/unrecognised personal text is NEVER sent externally.
const vocabulary=new Set(fold('hãy giúp tôi muốn mong muốn đề nghị điều chỉnh lịch làm việc tuần cân bằng số giờ ca phân công tăng giảm tải bớt thêm cho nhân viên người ưu tiên cao thấp bình thường tránh ngày nghỉ thích làm vào không quá tối đa giới hạn giờ một trong các và với của là được cần giữ nguyên quy tắc bắt buộc nguyện vọng ưu tiên đăng ký hợp lệ bếp phục vụ thu ngân kỹ năng bộ phận nhu cầu nhân sự thứ hai ba tư năm sáu bảy chủ nhật ca sáng chiều tối này tới tuần').split(' '));
export function pseudonymizeWish(raw:string,aliases:{code:string;employee_id:string}[],employees:{id:string;full_name:string}[]):string {
 let text=fold(raw);const names=new Map<string,string[]>();for(const a of aliases){const e=employees.find(e=>e.id===a.employee_id);if(e?.full_name){const n=fold(e.full_name);if(!n)continue;names.set(n,[...(names.get(n)??[]),a.code]);}}
 for(const [name,codes] of [...names].sort((a,b)=>b[0].length-a[0].length)){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const pattern=new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`,'g');if(pattern.test(text)){if(codes.length!==1||name.split(' ').length<2)throw new ScheduleError(422,'AMBIGUOUS_EMPLOYEE','Tên nhân viên bị trùng. Hãy dùng mã E được hiển thị cho đúng người.');text=text.replace(pattern,codes[0].toLowerCase());}}
 if(/\b(bo qua|bat chap|vo hieu|ghi de|khong can|ngoai dang ky|vuot|doi bo phan)\b/.test(text))throw new ScheduleError(422,'BUSINESS_RULE_CONFLICT','Nguyện vọng không được bỏ qua quy tắc nghiệp vụ.');
 if(/\b(?:cho|nhan vien|nguoi)\s+(?!(?:nhan vien\s+|nguoi\s+)?e\d{3}\b)/.test(text))throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Cần tên đầy đủ không trùng hoặc mã E của nhân viên, không dùng tên gọi tắt.');
 const codes=new Set(aliases.map(a=>a.code.toLowerCase()));
 const numericRemainder=text.replace(/\be\d{3}\b/g,'').replace(/\b\d{4}-\d{2}-\d{2}\b/g,'').replace(/\b(?:toi da|khong qua|gioi han)\s+\d{1,3}\s+gio\b/g,'');
 if(/\d/.test(numericRemainder))throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Chỉ nhập số trong mã E, ngày YYYY-MM-DD hoặc giới hạn dạng tối đa 20 giờ; không nhập thông tin liên hệ.');
 const tokens=text.match(/[a-z0-9]+(?:-\d+)*|[^\sa-z0-9,.;:!?()\-]/g)??[];
 for(const token of tokens){if(vocabulary.has(token)||codes.has(token)||/^\d{4}-\d{2}-\d{2}$/.test(token)||/^\d{1,3}$/.test(token))continue;throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Chưa nhận diện an toàn nội dung hoặc nhân viên. Dùng mã E, ngày YYYY-MM-DD và yêu cầu cân bằng/tăng/giảm tải; không nhập email, số điện thoại hoặc thông tin cá nhân.');}

 return text.replace(/\be\d{3}\b/g,s=>s.toUpperCase());
}
const active=new Set<string>();
export async function analyzeAdjustment(periodId:string,branchId:string,actorId:string,body:Record<string,unknown>,deps:{repository?:RegistrationSummaryRepository;advisor?:SchedulingAIAdvisor}={}) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['period_id','input_revision','assignments','schedule_id','expected_version','wish'].includes(k))||typeof body.wish!=='string'||!body.wish.trim()||body.wish.length>2000||typeof body.input_revision!=='string'||!Array.isArray(body.assignments))throw new ScheduleError(400,'INVALID_ADJUSTMENT_REQUEST','Cần nguyện vọng (tối đa 2000 ký tự) và phương án đã kiểm tra.');
 const {wish,...plan}=body;const state=await inspectPreview(periodId,branchId,plan,deps.repository);
 const prepared=buildAISummary({scope:'preview',rule_snapshot:state.snapshot,assignments:state.result.assignments,validation:{hard_constraints:'PASS',data_complete:false,coverage_complete:!state.result.shortages.length,issues:[],warnings:[]}});
 const text=pseudonymizeWish(wish as string,prepared.aliases,state.snapshot.employees);
 for(const date of text.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[]){if(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Ngày không hợp lệ; dùng YYYY-MM-DD.');if(date<state.snapshot.period.work_start_date||date>state.snapshot.period.work_end_date)throw new ScheduleError(422,'REQUEST_OUTSIDE_WEEK','Ngày đề nghị nằm ngoài tuần đang xem.');}
 const eligibleCodes=new Set(prepared.summary.employees.map(e=>e.code));
 if((text.match(/\bE\d{3}\b/g)??[]).some(c=>!eligibleCodes.has(c)))throw new ScheduleError(422,'INVALID_EMPLOYEE','Nhân viên không thuộc nhóm được phân công hợp lệ của lịch.');
 const advisor=deps.advisor??schedulingAIAdvisor();if(!advisor.configured||!advisor.analyzeAdjustment)throw new ScheduleError(503,'AI_NOT_CONFIGURED','AI phân tích nguyện vọng chưa được cấu hình.');
 const key=`${actorId}/${branchId}/${periodId}`;if(active.has(key))throw new ScheduleError(409,'AI_REVIEW_IN_PROGRESS','Đang phân tích nguyện vọng.');active.add(key);
 try{
 const result=parseAdjustment(await advisor.analyzeAdjustment({text,employees:prepared.summary.employees,dates:prepared.summary.dates,coverage:prepared.summary.coverage,rules:{non_overridable:['VALID_REGISTRATION','OFF','DEPARTMENT','SKILLS','NO_OVERLAP','WEEKLY_LIMIT','DEMAND']},preference_strength:'SOFT_PREFERENCE'},ADJUSTMENT_SCHEMA));
 const mentioned=new Set(text.match(/\bE\d{3}\b/g)??[]);if(result.employee_codes.some(c=>!mentioned.has(c)||!prepared.aliases.some(a=>a.code===c))||(result.status==='READY'&&[...mentioned].some(c=>!result.employee_codes.includes(c))))throw invalid();
 const hints:Record<string,RegExp>={BALANCE_HOURS:/can bang/,REDUCE_LOAD:/giam|bot/,INCREASE_LOAD:/tang|them/,PREFER_AVAILABILITY:/uu tien|thich|tranh|nghi|khong/};
 if(result.objectives.some(o=>!hints[o].test(text)))throw invalid();
 const priority=/uu tien cao/.test(text)?'HIGH':/uu tien thap/.test(text)?'LOW':'NORMAL';if(result.priority!==priority)throw invalid();
 if(result.status==='READY'&&(text.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[]).some(date=>!result.limits.some(l=>l.date===date)))throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','AI chưa đối chiếu đủ ngày được yêu cầu. Hãy nêu rõ ưu tiên hoặc tránh từng ngày.');
 if(result.status==='READY'&&/toi da|khong qua|gioi han/.test(text)&&!result.limits.length)throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Cần nêu rõ giới hạn giờ tuần và nhân viên áp dụng.');
 if(result.status==='READY'&&result.objectives.some(o=>o!=='BALANCE_HOURS')&&!result.employee_codes.length)throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Cần chỉ rõ nhân viên bằng mã E cho mục tiêu điều chỉnh này.');
 for(const limit of result.limits){
 if(limit.kind==='PREFER_DATE'&&result.limits.some(l=>l.kind==='AVOID_DATE'&&l.date===limit.date&&(l.employee_code===null||limit.employee_code===null||l.employee_code===limit.employee_code)))throw new ScheduleError(422,'REQUEST_INFEASIBLE','Yêu cầu vừa ưu tiên vừa tránh cùng ngày. Hãy làm rõ nguyện vọng.');
 if(limit.kind==='MAX_WEEKLY_HOURS'&&!/toi da|khong qua|gioi han/.test(text)||limit.kind==='AVOID_DATE'&&!/tranh|nghi|khong/.test(text)||limit.kind==='PREFER_DATE'&&!/uu tien|thich/.test(text))throw invalid();
 if(limit.employee_code!==null&&!result.employee_codes.includes(limit.employee_code))throw invalid();
 if(limit.kind==='MAX_WEEKLY_HOURS'){
 if(!(text.match(/\b\d{1,3}\b/g)??[]).some(v=>v===String(limit.value)))throw invalid();const id=prepared.aliases.find(a=>a.code===limit.employee_code)?.employee_id;const employee=state.input.employees.find(e=>e.id===id);if(!employee)throw invalid();
 if(employee.max_weekly_hours!==null&&limit.value!>Number(employee.max_weekly_hours))throw new ScheduleError(422,'BUSINESS_RULE_CONFLICT','Giới hạn đề nghị vượt giới hạn giờ làm đã cấu hình.');
 const start=Date.parse(state.input.period.work_start_date+'T00:00:00+07:00')/1000,end=start+7*86400;
 const committedHours=state.input.existing.filter(a=>a.employee_id===employee.id).reduce((hours,a)=>{const shift=state.input.shifts.find(s=>s.id===a.shift_id);if(!shift)throw new ScheduleError(422,'MISSING_SHIFT','Thiếu khung giờ phân công hiện hữu.');const [s,e]=interval(a.work_date,shift);return hours+Math.max(0,Math.min(e,end)-Math.max(s,start))/3600;},0);
 if(committedHours>limit.value!)throw new ScheduleError(422,'REQUEST_INFEASIBLE','Giới hạn đề nghị thấp hơn số giờ của các phân công hiện hữu ngoài phương án này.');
 }else{if(!text.includes(limit.date!))throw invalid();if(limit.date!<state.snapshot.period.work_start_date||limit.date!>state.snapshot.period.work_end_date)throw new ScheduleError(422,'REQUEST_OUTSIDE_WEEK','Ngày đề nghị nằm ngoài tuần đang xem.');
 if(limit.kind==='PREFER_DATE'){const id=prepared.aliases.find(a=>a.code===limit.employee_code)?.employee_id;const eligible=state.input.requirements.some(r=>r.work_date===limit.date&&r.required_count>0&&state.input.employees.some(e=>(!id||e.id===id)&&!assignmentIssue(state.input,e,r,state.input.existing)));if(!eligible)throw new ScheduleError(422,'REQUEST_INFEASIBLE','Không có đăng ký hợp lệ và vị trí phù hợp trong ngày đề nghị.');}}
 }
 await inspectPreview(periodId,branchId,plan,deps.repository);
 const planRevision=createHash('sha256').update(JSON.stringify({revision:state.revision,target:state.target,assignments:body.assignments})).digest('hex');
 const mapped=result.employee_codes.map(code=>({code,employee_id:prepared.aliases.find(a=>a.code===code)!.employee_id}));
 const analysisToken=result.status==='READY'?issueAdjustmentReceipt({actor:actorId,branch:branchId,period:periodId,revision:planRevision,intent:result,employees:mapped}):null;
 return {analysis_token:analysisToken,scope:'preview' as const,persisted:false as const,input_revision:state.revision,plan_revision:planRevision,...result,preference_strength:'SOFT_PREFERENCE' as const,business_rules_overridable:false as const,feasibility:'NOT_SOLVED' as const,message:result.status==='READY'?'Đã phân tích; chưa tạo hoặc thay đổi lịch. Tính khả thi tổng thể chưa được giải.':result.status==='NEEDS_CLARIFICATION'?'Nguyện vọng chưa rõ. Vui lòng nêu mục tiêu, mã nhân viên và ngày cụ thể.':'Yêu cầu nằm ngoài phạm vi phân tích hiện hỗ trợ.',employees:result.employee_codes.map(code=>({code,employee_id:prepared.aliases.find(a=>a.code===code)!.employee_id}))};
 }finally{active.delete(key);}
}
