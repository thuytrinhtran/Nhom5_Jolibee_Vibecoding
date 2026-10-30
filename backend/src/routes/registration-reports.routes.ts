import { Router } from 'express';
import { supabaseAdmin as db } from '../config/supabase.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { requireBranchScope } from '../middleware/data-scope.middleware.js';
import { effectivePeriodStatus } from '../registrations/period-status.js';

// Read-only handoff for the manager UI owner/TV3. No scheduling or demand writes.
export const registrationReports = Router();
registrationReports.use(authenticate, requireRole(['QL','GS']));
registrationReports.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
registrationReports.get('/:periodId', async(req,res,next)=>{
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.params.periodId)) return res.status(400).json({status:'error',message:'Mã kỳ không hợp lệ.'});
  try {
    const p=await db.from('registration_periods').select('*').eq('id',req.params.periodId).maybeSingle();
    if(p.error) throw p.error;
    if(!p.data) return res.status(404).json({status:'error',message:'Không tìm thấy kỳ đăng ký.'});
    res.locals.period=p.data; next();
  } catch {res.status(503).json({status:'error',message:'Không đọc được kỳ đăng ký.'});}
}, (req,res,next)=>requireBranchScope(()=>res.locals.period.branch_id)(req,res,next),async(req,res)=>{
  try {
    const p=res.locals.period;
    // Nested relations constrain rows on the database side to this authorized branch/period.
    const [headers,rows,sources]=await Promise.all([
      db.from('registration_submissions').select('employee_id,status,submitted_at,updated_at,sample_batch_id,employees!inner(full_name,branch_id,department_id,status,skill_level,users!inner(role,is_active,branch_id))').eq('period_id',p.id).eq('employees.branch_id',p.branch_id).eq('employees.status','ACTIVE').neq('employees.skill_level','CREW_LEADER').eq('employees.users.role','NV').eq('employees.users.is_active',true).eq('employees.users.branch_id',p.branch_id),
      db.from('shift_registrations').select('employee_id,work_date,shift_id,status,submitted_at,shifts!inner(is_active,branch_id)').eq('period_id',p.id).eq('status','VALID').eq('shifts.is_active',true),
      db.from('registration_submissions_sourced').select('employee_id,sample_batch_id').eq('period_id',p.id),
    ]);
    if(headers.error||rows.error||sources.error)throw headers.error||rows.error||sources.error;
    const includeSamples=req.query.include_samples==='true';
    const provenance=new Map((sources.data||[]).map(h=>[h.employee_id,h.sample_batch_id]));
    const submissions=(headers.data||[]).map(h=>({...h,sample_batch_id:provenance.get(h.employee_id)??h.sample_batch_id})).filter(h=>includeSamples||!h.sample_batch_id);
    const valid=new Set(submissions.filter(h=>h.status==='VALID'&&h.submitted_at).map(h=>h.employee_id));
    const registrations=(rows.data||[]).filter(r=>{
      const shift=r.shifts as unknown as {branch_id:string|null};
      return valid.has(r.employee_id)&&r.submitted_at&&r.work_date>=p.work_start_date&&r.work_date<=p.work_end_date&&(shift.branch_id===null||shift.branch_id===p.branch_id);
    });
    res.json({status:'ok',period:{...p,stored_status:p.status,status:effectivePeriodStatus(p)},include_samples:includeSamples,submissions,registrations,server_now:new Date().toISOString()});
  }catch{res.status(503).json({status:'error',message:'Không tải được tổng hợp đăng ký.'});}
});
