import { ScheduleError } from './scheduling.engine.js';
import type { AIReport } from './schedule-ai.types.js';
const stringArray={type:'array',maxItems:10,items:{type:'string',maxLength:1200}};
export const AI_REPORT_SCHEMA={type:'object',additionalProperties:false,required:['conclusion','good_points','concerns','suggestions','limitations'],properties:{
  conclusion:{type:'string',enum:['SUITABLE','NEEDS_ADJUSTMENT','INSUFFICIENT_DATA']},good_points:stringArray,concerns:stringArray,limitations:stringArray,
  suggestions:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['description','reason','candidate_assignments'],properties:{
    description:{type:'string',maxLength:1200},reason:{type:'string',maxLength:1200},candidate_assignments:{anyOf:[{type:'null'},{type:'array',maxItems:500,items:{type:'object',additionalProperties:false,required:['employee_code','work_date','shift_code','department_code'],properties:{employee_code:{type:'string'},work_date:{type:'string'},shift_code:{type:'string'},department_code:{type:'string'}}}}]}
  }}}}};
// Gemini's documented JSON Schema subset omits maxLength. Keep application
// limits in AI_REPORT_SCHEMA and parseAIReport; only adapt the outbound schema.
function geminiSchema(value:unknown):unknown {
  if(Array.isArray(value))return value.map(geminiSchema);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='maxLength').map(([key,item])=>[key,geminiSchema(item)]));
  return value;
}
// Evaluation is advisory text only. Keep the full report/parser contract for
// stored proposals and Rule Engine checks, but do not compile a 500-row nested
// assignment alternative into this provider's constrained decoding schema.
export const GEMINI_AI_REPORT_SCHEMA=geminiSchema({...AI_REPORT_SCHEMA,properties:{...AI_REPORT_SCHEMA.properties,
  suggestions:{...AI_REPORT_SCHEMA.properties.suggestions,items:{...AI_REPORT_SCHEMA.properties.suggestions.items,
    properties:{...AI_REPORT_SCHEMA.properties.suggestions.items.properties,candidate_assignments:{type:'null'}}}}}});
export function parseAIReport(value:unknown):AIReport {
  const bad=()=>{throw new ScheduleError(502,'AI_INVALID_RESPONSE','AI trả kết quả sai định dạng; chưa có đánh giá hợp lệ.');};
  const object=(v:unknown,keys:string[]):Record<string,unknown>=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return bad();
    return v as Record<string,unknown>;
  };
  const text=(s:unknown):string=>typeof s==='string'&&s.trim().length>0&&s.length<=1200?s.trim():bad();
  const strings=(v:unknown):string[]=>Array.isArray(v)&&v.length<=10?v.map(text):bad();
  const report=object(value,['conclusion','good_points','concerns','suggestions','limitations']);
  if(!['SUITABLE','NEEDS_ADJUSTMENT','INSUFFICIENT_DATA'].includes(report.conclusion as string)||!Array.isArray(report.suggestions)||report.suggestions.length>5)return bad();
  return {conclusion:report.conclusion as AIReport['conclusion'],good_points:strings(report.good_points),concerns:strings(report.concerns),limitations:strings(report.limitations),
    suggestions:report.suggestions.map(v=>{const s=object(v,['description','reason','candidate_assignments']);let assignments:AIReport['suggestions'][number]['candidate_assignments']=null;
      if(s.candidate_assignments!==null){
        if(!Array.isArray(s.candidate_assignments)||s.candidate_assignments.length>500)return bad();
        assignments=s.candidate_assignments.map(v=>{const a=object(v,['employee_code','work_date','shift_code','department_code']);
          if(typeof a.work_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.work_date)||!Number.isFinite(Date.parse(a.work_date))||new Date(a.work_date).toISOString().slice(0,10)!==a.work_date)return bad();
          for(const [field,prefix] of [['employee_code','E'],['shift_code','S'],['department_code','D']])if(typeof a[field]!=='string'||!new RegExp(`^${prefix}\\d{3,}$`).test(a[field] as string))return bad();
          return {employee_code:a.employee_code as string,work_date:a.work_date,shift_code:a.shift_code as string,department_code:a.department_code as string};});
      }
      return {description:text(s.description),reason:text(s.reason),candidate_assignments:assignments};})};
}
