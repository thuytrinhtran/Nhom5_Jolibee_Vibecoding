import type { Assignment, SchedulingInput } from './scheduling.engine.js';
import type { AISummary } from './schedule-ai.types.js';
export interface SchedulingAIRequest {
  schedule_id:string;version:number;input:SchedulingInput;assignments:Assignment[];
  alternatives?:{id:string;assignments:Assignment[]}[];goal?:string;
}
export interface SchedulingAIAdvice {
  status:'NOT_CONFIGURED'|'AVAILABLE'|'FAILED';message:string;version:number;
  observations?:string[];proposals?:{explanation:string;assignments:Assignment[]}[];
}
export interface SchedulingAIAdvisor {
  readonly configured:boolean;
  readonly model:string|null;
  evaluate(summary:AISummary):Promise<unknown>;
}
// No provider, credentials, network calls, confidence scores or database write access.
export class UnconfiguredSchedulingAIAdvisor implements SchedulingAIAdvisor {
  readonly configured=false;readonly model=null;
  async evaluate(_summary:AISummary):Promise<never>{throw new Error('AI chưa được cấu hình');}
  async review(request:SchedulingAIRequest):Promise<SchedulingAIAdvice>{return{status:'NOT_CONFIGURED',message:'AI chưa được cấu hình',version:request.version};}
  async compare(request:SchedulingAIRequest){return this.review(request);}
  async suggest(request:SchedulingAIRequest){return this.review(request);}
}
