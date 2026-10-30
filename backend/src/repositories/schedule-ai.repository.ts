import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { ScheduleError } from '../services/scheduling.engine.js';
import type { AIEvaluationRecord } from '../services/schedule-ai.types.js';
export interface ScheduleAIRepository {
  latest(scheduleId:string):Promise<AIEvaluationRecord|null>;
  save(scheduleId:string,record:Omit<AIEvaluationRecord,'id'|'created_at'>):Promise<AIEvaluationRecord>;
}
const records=new Map<string,AIEvaluationRecord>();
export class MockScheduleAIRepository implements ScheduleAIRepository {
  async latest(id:string){return structuredClone(records.get(id)??null);}
  async save(id:string,record:Omit<AIEvaluationRecord,'id'|'created_at'>){const saved={...record,id:randomUUID(),created_at:new Date().toISOString()};records.set(id,structuredClone(saved));return saved;}
}
export class SupabaseScheduleAIRepository implements ScheduleAIRepository {
  constructor(private readonly db=supabaseAdmin){}
  // The service verifies schedule ownership before either method. No schema mutation or fallback.
  async latest(scheduleId:string):Promise<AIEvaluationRecord|null> {
    const result=await this.db.from('ai_schedule_evaluations').select('id,status,evaluation,error_message,model_name,created_at').eq('schedule_id',scheduleId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
    if(result.error)throw new ScheduleError(503,'AI_STORAGE_UNAVAILABLE','Không thể đọc bảng đánh giá AI hiện có. Cần nhóm kiểm tra schema/quyền; không tự thay database.');
    return result.data as AIEvaluationRecord|null;
  }
  async save(scheduleId:string,record:Omit<AIEvaluationRecord,'id'|'created_at'>):Promise<AIEvaluationRecord> {
    const result=await this.db.from('ai_schedule_evaluations').insert({...record,schedule_id:scheduleId}).select('id,status,evaluation,error_message,model_name,created_at').single();
    if(result.error)throw new ScheduleError(503,'AI_STORAGE_UNAVAILABLE','Không thể lưu đánh giá vào bảng AI hiện có. Lịch không thay đổi; cần nhóm kiểm tra schema/quyền.');
    return result.data as AIEvaluationRecord;
  }
}
