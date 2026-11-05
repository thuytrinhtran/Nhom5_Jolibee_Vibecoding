// Reads current config/model, creates an in-memory preview and calls Gemini.
// No database writes, auth changes, migration or schedule lifecycle calls.
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
process.env.NODE_ENV='development';process.env.SCHEDULING_DATA_SOURCE='supabase';
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {evaluatePreview,previewAIConfiguration}=require('../dist/services/preview-ai.service.js');
const {GeminiSchedulingAIAdvisor}=require('../dist/services/schedule-ai.gemini.js');
(async()=>{
 const model=process.env.TV3_AI_MODEL;
 console.log(JSON.stringify({environment:process.env.NODE_ENV,source:process.env.SCHEDULING_DATA_SOURCE,...previewAIConfiguration(),key_present:!!process.env.GEMINI_API_KEY,endpoint:'v1beta.generateContent'}));
 const metadata=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY},signal:AbortSignal.timeout(15000)});
 const info=await metadata.json();console.log(JSON.stringify({model_metadata_http:metadata.status,model_name:info.name,supported_methods:info.supportedGenerationMethods}));
 const p='7f48f53e-d707-4a32-9f15-eb32aeb0095a';
 const period=await db.from('registration_periods').select('branch_id').eq('id',p).single();if(period.error)throw Error('PERIOD_READ_FAILED');
 const preview=await previewSchedule(p,period.data.branch_id,{});
 let requests=0;
 const send=async(url,options)=>{requests++;const body=JSON.parse(options.body),started=Date.now();
  console.log(JSON.stringify({request:requests,model,request_bytes:Buffer.byteLength(options.body),response_format:body.generationConfig.responseFormat.text.mimeType,tools_present:!!body.tools}));
  const result=await fetch(url,options);console.log(JSON.stringify({request:requests,provider_http:result.status,elapsed_ms:Date.now()-started}));return result;
 };
 const result=await evaluatePreview(p,period.data.branch_id,'local-readonly-diagnostic',{period_id:p,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}))},{advisor:new GeminiSchedulingAIAdvisor(process.env.GEMINI_API_KEY,model,send)});
 console.log(JSON.stringify({ai_status:result.status,conclusion:result.evaluation?.report.conclusion,requests,preview_assignments:preview.result.assigned_count,persisted:result.persisted}));
})().catch(error=>{console.error(JSON.stringify({code:error.code??error.name,message:error.message}));process.exitCode=1;});
