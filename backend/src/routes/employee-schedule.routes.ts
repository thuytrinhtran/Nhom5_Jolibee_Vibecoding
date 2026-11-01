import { Router } from 'express';
import { authenticate,requireRole } from '../middleware/auth.middleware.js';
import { supabaseAdmin } from '../config/supabase.js';

export const employeeScheduleRoutes=Router();
employeeScheduleRoutes.use(authenticate,requireRole(['NV']));
employeeScheduleRoutes.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
employeeScheduleRoutes.get('/',async(req,res)=>{
 const week=req.query.week_start;
 if(Object.keys(req.query).some(k=>k!=='week_start')||typeof week!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(week)
  ||!Number.isFinite(Date.parse(week))||new Date(week).toISOString().slice(0,10)!==week||new Date(week).getUTCDay()!==1)
  return res.status(400).json({status:'error',code:'INVALID_WEEK',message:'Chọn ngày thứ Hai hợp lệ; không gửi mã nhân viên hoặc chi nhánh.'});
 try{
  const {data,error}=await supabaseAdmin.rpc('employee_schedule_week',{p_actor_id:req.user!.id,p_week_start:week});
  if(error){const forbidden=error.code==='42501',ambiguous=error.message?.includes('AMBIGUOUS_');
   return res.status(forbidden?403:ambiguous?409:503).json({status:'error',code:forbidden?'EMPLOYEE_SCOPE_INVALID':ambiguous?'AMBIGUOUS_PUBLISHED_SCHEDULE':'SCHEDULE_UNAVAILABLE',message:forbidden?'Hồ sơ nhân viên hoặc chi nhánh không hợp lệ.':ambiguous?'Có lịch công bố trùng phạm vi. Vui lòng liên hệ quản lý.':'Chưa thể đọc lịch công bố. Vui lòng thử lại.'});}
  if(!data||!Array.isArray(data.assignments)||!Array.isArray(data.schedules))throw Error('Invalid result');
  return res.json({status:'ok',result:data});
 }catch{return res.status(503).json({status:'error',code:'SCHEDULE_UNAVAILABLE',message:'Không thể đọc lịch. Vui lòng thử lại.'});}
});
