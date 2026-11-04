import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate,requireRole } from '../middleware/auth.middleware.js';
import { requireNonTestScheduleWrites,isTestPreviewRequested } from '../services/test-preview-policy.js';
import { ScheduleError } from '../services/scheduling.engine.js';
import { requireRealSchedulingData } from '../repositories/registration-summary.repository.js';
import { requireShiftChangeWriteScope } from '../services/shift-change-write-scope.js';
import { localTv5Rpc } from '../services/tv5-local-rpc.js';

export const shiftChangeRoutes=Router();
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const enabled=()=>process.env.TV5_PERSISTENCE_ENABLED==='true'&&!isTestPreviewRequested();
const fields:Record<string,string[]>={CREATE_REQUEST:['assignment_id','reason','proposed_employee_id'],REPORT:['assignment_id','reason','proposed_employee_id'],INVITE:['kind','source_id','target_employee_id','expires_at'],ACCEPT:['invitation_id'],DECLINE:['invitation_id'],APPROVE:['kind','source_id','invitation_id'],REJECT:['kind','source_id','reason'],EXPIRE:['kind','source_id']};
shiftChangeRoutes.use(authenticate,requireRole(['NV','QL']));
shiftChangeRoutes.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await(process.env.TV5_LOCAL_PG_RPC_ENABLED==='true'?localTv5Rpc(name,args):supabaseAdmin.rpc(name,args));
 if(error){const message=String(error.message??'');const code=['FORBIDDEN','ASSIGNMENT_STALE','FEEDBACK_CLOSED','DUPLICATE_OPEN_REQUEST','REASON_REQUIRED','INVALID_EXPIRY','INELIGIBLE_REPLACEMENT','CONFIRMATION_REQUIRED','INVITATION_CLOSED','SOURCE_CLOSED','DUPLICATE_INVITATION','REQUEST_CONFLICT','NOT_FOUND'].find(c=>message.includes(c));
  throw new ScheduleError(error.code==='42501'?403:code==='NOT_FOUND'?404:code?409:503,code??'SHIFT_CHANGE_UNAVAILABLE',code?`Không thể xử lý: ${code}. Hãy tải lại và kiểm tra.`:'Chức năng chưa sẵn sàng hoặc đang bận. Thử lại cùng yêu cầu.');}
 return data;
}
function fail(res:any,e:unknown){const issue=e instanceof ScheduleError?e:new ScheduleError(503,'SHIFT_CHANGE_UNAVAILABLE','Không thể xử lý yêu cầu đổi ca.');return res.status(issue.status).json({status:'error',code:issue.code,message:issue.message});}
shiftChangeRoutes.get('/',async(req,res)=>{try{
 if(Object.keys(req.query).length)throw new ScheduleError(400,'INVALID_REQUEST','Không gửi mã nhân viên hoặc chi nhánh.');
 const data=await rpc('tv5_read',{p_actor_id:req.user!.id});
 if(!Array.isArray(data?.sources)||!Array.isArray(data?.invitations))throw new ScheduleError(503,'INVALID_TV5_RESPONSE','Phản hồi queue không hợp lệ.');
 return res.json({status:'ok',result:{...data,enabled:enabled()}});
}catch(e){return fail(res,e);}});
shiftChangeRoutes.get('/candidates',async(req,res)=>{try{
 if(Object.keys(req.query).some(k=>k!=='assignment_id')||!uuid(req.query.assignment_id))throw new ScheduleError(400,'INVALID_REQUEST','Cần mã phân công hợp lệ.');
 const data=await rpc('tv5_candidates_for_actor',{p_actor_id:req.user!.id,p_assignment_id:req.query.assignment_id});
 if(!Array.isArray(data))throw new ScheduleError(503,'INVALID_TV5_RESPONSE','Phản hồi ứng viên không hợp lệ.');
 return res.json({status:'ok',result:data});
}catch(e){return fail(res,e);}});
shiftChangeRoutes.post('/actions',async(req,res)=>{try{
 requireNonTestScheduleWrites();
 if(!enabled())throw new ScheduleError(503,'TV5_PERSISTENCE_DISABLED','Chưa bật lưu đổi ca. Cần nghiệm thu migration TV5 trước.');
 requireRealSchedulingData();
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','request_id','data'].includes(k))||!uuid(body.request_id)||typeof body.action!=='string'||!Object.hasOwn(fields,body.action)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ScheduleError(400,'INVALID_REQUEST','Yêu cầu không hợp lệ.');
 const {action,data}=body,allowed=fields[action];
 if(Object.keys(data).some(k=>!allowed.includes(k))||allowed.some(k=>{
  if(k==='proposed_employee_id')return data[k]!==undefined&&data[k]!==null&&!uuid(data[k]);
  if(k.endsWith('_id'))return !uuid(data[k]);
  if(k==='reason')return typeof data[k]!=='string'||!data[k].trim();
  if(k==='kind')return !['REQUEST','INCIDENT'].includes(data[k]);
  return typeof data[k]!=='string'||!Number.isFinite(Date.parse(data[k]));
 }))throw new ScheduleError(400,'INVALID_REQUEST','Thiếu thông tin hoặc có trường không được phép.');
 const requiredRole=['CREATE_REQUEST','REPORT','ACCEPT','DECLINE'].includes(action)?'NV':'QL';
 if(req.user!.role!==requiredRole)throw new ScheduleError(403,'FORBIDDEN','Không có quyền thao tác này.');
 await requireShiftChangeWriteScope(action,data,req.user!.branch_id);
 const result=await rpc('tv5_mutate',{p_actor_id:req.user!.id,p_action:action,p_request_id:body.request_id,p_data:data});
 if(!result||typeof result!=='object')throw new ScheduleError(503,'INVALID_TV5_RESPONSE','Chưa xác nhận được kết quả. Thử lại cùng yêu cầu.');
 return res.json({status:'ok',result});
}catch(e){return fail(res,e);}});
