import { createHash } from 'node:crypto';
import { inspectPreview, previewSchedule } from './schedule-preview.service.js';
import { readProposalReceipt } from './schedule-adjustment-receipt.js';
import { ScheduleError } from './scheduling.engine.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';

// "Apply" means a reviewed preview for the browser editor only. This service has no writer.
export async function applyAdjustmentProposal(periodId:string,branchId:string,actorId:string,body:Record<string,unknown>,repository?:RegistrationSummaryRepository) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['period_id','input_revision','assignments','schedule_id','expected_version','proposal_assignments','proposal_token'].includes(k))||!Array.isArray(body.assignments)||!Array.isArray(body.proposal_assignments)||body.proposal_assignments.length>10000||typeof body.proposal_token!=='string'||typeof body.input_revision!=='string')throw new ScheduleError(400,'INVALID_PROPOSAL_APPLICATION','Cần lịch gốc và đề xuất đã xác nhận.');
 const fields=['employee_id','work_date','shift_id','department_id'];
 if(body.proposal_assignments.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length!==fields.length||fields.some(k=>typeof a[k]!=='string')))throw new ScheduleError(400,'INVALID_PROPOSAL_APPLICATION','Phân công đề xuất không hợp lệ.');
 const {proposal_assignments,proposal_token,...plan}=body;
 const state=await inspectPreview(periodId,branchId,plan,repository);
 const revision=createHash('sha256').update(JSON.stringify({revision:state.revision,target:state.target,assignments:body.assignments})).digest('hex');
 const assignments=proposal_assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
 const expected={actor:actorId,branch:branchId,period:periodId,revision,proposal:createHash('sha256').update(JSON.stringify(assignments)).digest('hex')};
 readProposalReceipt(proposal_token,expected);
 // Reload source/target and review the ENTIRE proposed plan using the existing preview path.
 const reviewed=await previewSchedule(periodId,branchId,{...plan,assignments},repository);
 readProposalReceipt(proposal_token,expected);
 return reviewed;
}
