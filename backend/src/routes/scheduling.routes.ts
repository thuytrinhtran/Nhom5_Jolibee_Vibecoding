import { prepareApprovalHandoff, validateSchedule } from '../services/schedule-review.service.js';
import { readManagerCalendar } from '../services/manager-calendar.service.js';
import { previewSchedule } from '../services/schedule-preview.service.js';
import { persistPreview } from '../services/draft-persistence.service.js';
import { requireDraftPersistenceEnabled } from '../services/draft-write-policy.js';
import { isMockSchedulingFlow } from '../services/mock-scheduling.service.js';
import { evaluateSchedule, readAIEvaluation } from '../services/schedule-ai.service.js';
import { editMockDraft } from '../services/mock-scheduling.service.js';
import { clearDemand, readDemand, saveDemand } from '../services/staffing-demand.service.js';
import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { createDraft, readDraft, listSchedulingPeriods, readSchedulingContext, readRegistrationSummary } from '../services/scheduling.service.js';
import { ScheduleError } from '../services/scheduling.engine.js';
const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
router.use(authenticate, requireRole(['QL']));
router.post('/drafts',async(req,res)=>{
  try{
    requireDraftPersistenceEnabled();
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!req.body||typeof req.body.period_id!=='string'||!uuid.test(req.body.period_id))throw new ScheduleError(400,'INVALID_PERIOD_ID','Cần mã tuần hợp lệ.');
    return res.json({status:'ok',...await persistPreview(req.body.period_id,req.user.branch_id,req.user.id,req.body)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'DRAFT_SAVE_UNAVAILABLE','Chưa thể xác nhận lưu. Hãy tải lại tuần.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
router.post('/preview',async(req,res)=>{
  try {
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.period_id!=='string'||!uuid.test(body.period_id))throw new ScheduleError(400,'INVALID_PERIOD_ID','Cần mã tuần hợp lệ.');
    return res.json({status:'ok',result:await previewSchedule(body.period_id,req.user.branch_id,body)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'PREVIEW_UNAVAILABLE','Không thể xem trước lịch. Không có lịch nào được lưu.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
router.get('/periods/:id/calendar',async(req,res)=>{
  try {
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_PERIOD_ID','Mã tuần không hợp lệ.');
    return res.json({status:'ok',result:await readManagerCalendar(req.params.id,req.user.branch_id)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được lịch. Vui lòng thử lại.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
// Specific read routes must precede /:id.
router.get('/periods', async (req, res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403, 'BRANCH_REQUIRED', 'Quản lý chưa được phân công chi nhánh.');
    return res.json({ status: 'ok', periods: await listSchedulingPeriods(req.user.branch_id) });
  } catch (err) {
    const error = err instanceof ScheduleError ? err : new ScheduleError(503, 'SCHEDULING_UNAVAILABLE', 'Không thể đọc danh sách tuần.');
    return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
  }
});
router.get('/periods/:id/requirements', async (req, res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if (!uuid.test(req.params.id)) throw new ScheduleError(400,'INVALID_PERIOD_ID','Mã đợt phải là UUID.');
    return res.json({status:'ok',result:await readDemand(req.params.id,req.user.branch_id)});
  } catch (err) {
    const error=err instanceof ScheduleError?err:new ScheduleError(503,'DEMAND_UNAVAILABLE','Không thể đọc nhu cầu nhân sự.');
    return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  }
});
router.put('/periods/:id/requirements', async (req, res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if (!uuid.test(req.params.id)) throw new ScheduleError(400,'INVALID_PERIOD_ID','Mã đợt phải là UUID.');
    return res.json({status:'ok',result:await saveDemand(req.params.id,req.user.branch_id,req.user.id,req.body)});
  } catch (err) {
    const error=err instanceof ScheduleError?err:new ScheduleError(503,'DEMAND_UNAVAILABLE','Không thể lưu nhu cầu. Hãy tải lại tuần để kiểm tra trước khi thử lại.');
    return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  }
});
router.delete('/periods/:id/requirements', async (req,res) => {
  try {
    if(!req.user?.branch_id) throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id)) throw new ScheduleError(400,'INVALID_PERIOD_ID','Mã đợt phải là UUID.');
    return res.json({status:'ok',result:await clearDemand(req.params.id,req.user.branch_id,req.body)});
  } catch(err) {
    const error=err instanceof ScheduleError?err:new ScheduleError(503,'DEMAND_UNAVAILABLE','Không thể xóa nhu cầu. Hãy tải lại tuần để kiểm tra.');
    return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  }
});
router.get('/periods/:id/registrations-summary', async (req, res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403, 'BRANCH_REQUIRED', 'Quản lý chưa được phân công chi nhánh.');
    if (!uuid.test(req.params.id)) throw new ScheduleError(400, 'INVALID_PERIOD_ID', 'Mã đợt phải là UUID.');
    const filters: { work_date?: string; shift_id?: string; department_id?: string } = {};
    for (const field of ['work_date', 'shift_id', 'department_id'] as const) {
      const value = req.query[field];
      if (value === undefined) continue;
      const valid = typeof value === 'string' && (field === 'work_date'
        ? /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
        : uuid.test(value));
      if (!valid) throw new ScheduleError(400, 'INVALID_FILTER', 'Bộ lọc ngày, ca hoặc bộ phận không hợp lệ.');
      filters[field] = value as string;
    }
    return res.json({ status: 'ok', result: await readRegistrationSummary(req.params.id, req.user.branch_id, filters) });
  } catch (err) {
    const error = err instanceof ScheduleError ? err : new ScheduleError(503, 'SUMMARY_UNAVAILABLE', 'Không thể tổng hợp đăng ký.');
    return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
  }
});
router.get('/periods/:id', async (req, res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403, 'BRANCH_REQUIRED', 'Quản lý chưa được phân công chi nhánh.');
    if (!uuid.test(req.params.id)) throw new ScheduleError(400, 'INVALID_PERIOD_ID', 'Mã đợt phải là UUID.');
    return res.json({ status: 'ok', result: await readSchedulingContext(req.params.id, req.user.branch_id) });
  } catch (err) {
    const error = err instanceof ScheduleError ? err : new ScheduleError(503, 'SCHEDULING_UNAVAILABLE', 'Không thể đọc dữ liệu của tuần.');
    return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
  }
});
router.get('/:id/ai-evaluation',async(req,res)=>{
  try {
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    const version=req.query.expected_version;
    if(typeof version!=='string'||!/^\d+$/.test(version))throw new ScheduleError(400,'INVALID_VERSION','Cần expected_version hợp lệ.');
    return res.json({status:'ok',result:await readAIEvaluation(req.params.id,req.user.branch_id,Number(version))});
  }catch(error){const issue=error instanceof ScheduleError?error:new ScheduleError(503,'AI_UNAVAILABLE','Không thể đọc đánh giá AI.');return res.status(issue.status).json({status:'error',code:issue.code,message:issue.message});}
});
router.post('/:id/ai-evaluation',async(req,res)=>{
  try {
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    return res.json({status:'ok',result:await evaluateSchedule(req.params.id,req.user.branch_id,req.body)});
  }catch(error){const issue=error instanceof ScheduleError?error:new ScheduleError(503,'AI_UNAVAILABLE','Không thể đánh giá AI. Lịch không thay đổi.');return res.status(issue.status).json({status:'error',code:issue.code,message:issue.message});}
});
router.post('/generate', async (req,res) => {
  try {
    requireDraftPersistenceEnabled();
    if (!req.user?.branch_id) throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    const { period_id } = req.body || {};
    if (typeof period_id !== 'string' || !uuid.test(period_id)) throw new ScheduleError(400,'INVALID_PERIOD_ID','period_id phải là UUID của đợt đăng ký tuần cần xếp lịch.');
    if(req.body.regenerate!==undefined&&typeof req.body.regenerate!=='boolean')throw new ScheduleError(400,'INVALID_REGENERATE','regenerate phải là boolean.');
    if(req.body.regenerate===true&&!Number.isSafeInteger(req.body.expected_version))throw new ScheduleError(400,'INVALID_VERSION','Cần expected_version để tạo lại lịch.');
    const data = await createDraft(period_id,req.user.id,req.user.branch_id,{regenerate:req.body.regenerate,expectedVersion:req.body.expected_version});
    return res.status(data.reused ? 200 : 201).json({ status:'ok', ...data });
  } catch (err) {
    const error = err instanceof ScheduleError ? err : new ScheduleError(503,'SCHEDULING_UNAVAILABLE','Không thể tạo lịch. Vui lòng thử lại.');
    return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  }
});
router.post('/:id/validate',async(req,res)=>{
  try{
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    return res.json({status:'ok',result:await validateSchedule(req.params.id,req.user.branch_id,req.body?.expected_version)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'SCHEDULE_REVIEW_UNAVAILABLE','Không thể kiểm tra lịch.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
router.post('/:id/approval-handoff',async(req,res)=>{
  try{
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    return res.json({status:'ok',result:await prepareApprovalHandoff(req.params.id,req.user.branch_id,req.user.id,req.body)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'HANDOFF_UNAVAILABLE','Không thể chuẩn bị dữ liệu bàn giao.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
router.patch('/:id/draft-assignments',async(req,res)=>{
  try{
    requireDraftPersistenceEnabled();
    if(!req.user?.branch_id)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if(!uuid.test(req.params.id))throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    if(isMockSchedulingFlow())return res.json({status:'ok',result:await editMockDraft(req.params.id,req.user.branch_id,req.user.id,req.body)});
    if(!req.body||typeof req.body.period_id!=='string'||!uuid.test(req.body.period_id))throw new ScheduleError(400,'INVALID_PERIOD_ID','Cần mã tuần hợp lệ.');
    return res.json({status:'ok',...await persistPreview(req.body.period_id,req.user.branch_id,req.user.id,req.body,req.params.id)});
  }catch(err){const error=err instanceof ScheduleError?err:new ScheduleError(503,'DRAFT_EDIT_UNAVAILABLE','Không thể lưu chỉnh sửa lịch dự kiến.');return res.status(error.status).json({status:'error',code:error.code,message:error.message});}
});
router.get('/:id', async (req,res) => {
  try {
    if (!req.user?.branch_id) throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    if (!uuid.test(req.params.id)) throw new ScheduleError(400,'INVALID_SCHEDULE_ID','Mã lịch phải là UUID.');
    return res.json({status:'ok',result:await readDraft(req.params.id,req.user.branch_id)});
  } catch (err) {
    const error = err instanceof ScheduleError ? err : new ScheduleError(503,'SCHEDULING_UNAVAILABLE','Không thể đọc lịch. Vui lòng thử lại.');
    return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  }
});
export default router;
