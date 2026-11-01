import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ScheduleError } from './scheduling.engine.js';
// Ephemeral process key: no secret in source/env, no database storage. Restart invalidates receipts.
const key=randomBytes(32);
export interface AdjustmentReceipt {
 actor:string;branch:string;period:string;revision:string;expires:number;
 intent:{status:string;objectives:string[];employee_codes:string[];priority:string;limits:{kind:string;employee_code:string|null;date:string|null;value:number|null}[]};
 employees:{code:string;employee_id:string}[];
}
export function issueAdjustmentReceipt(data:Omit<AdjustmentReceipt,'expires'>) {
 const payload=Buffer.from(JSON.stringify({...data,expires:Date.now()+15*60_000})).toString('base64url');
 return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
}
export function readAdjustmentReceipt(token:unknown,actor:string,branch:string,period:string,revision:string):AdjustmentReceipt {
 const invalid=()=>new ScheduleError(409,'ADJUSTMENT_ANALYSIS_STALE','Phân tích đã hết hiệu lực hoặc không khớp phương án. Hãy phân tích lại.');
 if(typeof token!=='string'||token.length>24000)throw invalid();const parts=token.split('.');if(parts.length!==2)throw invalid();
 const signature=Buffer.from(parts[1],'base64url'),expected=createHmac('sha256',key).update(parts[0]).digest();
 if(signature.length!==expected.length||!timingSafeEqual(signature,expected))throw invalid();
 let data:AdjustmentReceipt;try{data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw invalid();}
 if(data.actor!==actor||data.branch!==branch||data.period!==period||data.revision!==revision||!Number.isFinite(data.expires)||data.expires<=Date.now()||data.intent?.status!=='READY')throw invalid();
 return data;
}

interface ProposalReceipt {kind:'proposal';actor:string;branch:string;period:string;revision:string;proposal:string;expires:number}
export function issueProposalReceipt(data:Omit<ProposalReceipt,'kind'>) {
 const payload=Buffer.from(JSON.stringify({...data,kind:'proposal'})).toString('base64url');
 return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
}
export function readProposalReceipt(token:unknown,expected:Omit<ProposalReceipt,'kind'|'expires'>) {
 const invalid=()=>new ScheduleError(409,'ADJUSTMENT_PROPOSAL_STALE','Đề xuất hết hạn hoặc không khớp lịch hiện tại. Hãy phân tích và tạo lại đề xuất.');
 if(typeof token!=='string'||token.length>24000)throw invalid();const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length)throw invalid();
 const actual=Buffer.from(signature,'base64url'),wanted=createHmac('sha256',key).update(payload).digest();if(actual.length!==wanted.length||!timingSafeEqual(actual,wanted))throw invalid();
 let data:ProposalReceipt;try{data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{throw invalid();}
 if(data.kind!=='proposal'||!Number.isFinite(data.expires)||data.expires<=Date.now()||Object.entries(expected).some(([k,v])=>data[k as keyof ProposalReceipt]!==v))throw invalid();
 return data;
}
