import type { RequestHandler } from 'express';
import { ScheduleError } from './scheduling.engine.js';

export const LD_TEST_BATCH_ID = '6e1d2026-1102-4000-8000-000000000017';
export const LD_TEST_BRANCH_ID = '11111111-1111-1111-1111-111111111111';
export const LD_TEST_PERIOD_ID = '79a979cc-8347-48b5-a411-f03bd8aceb92';

// The HTTP payload never controls these switches. A dedicated backend process
// running this mode is read-only for all schedule/demand/workflow mutations.
export const isTestPreviewRequested = (env:NodeJS.ProcessEnv=process.env) => env.TV3_TEST_PREVIEW_ENABLED==='true';
export function requireTestPreview(env:NodeJS.ProcessEnv=process.env) {
  if(!isTestPreviewRequested(env))throw new ScheduleError(403,'TEST_PREVIEW_DISABLED','Backend chưa bật preview kiểm thử.');
  if(!['development','test'].includes(env.NODE_ENV??'')||env.TV3_TEST_PREVIEW_BATCH_ID!==LD_TEST_BATCH_ID)
    throw new ScheduleError(503,'INVALID_TEST_PREVIEW_CONFIG','Preview kiểm thử cần môi trường development/test và đúng batch đã duyệt.');
  return LD_TEST_BATCH_ID;
}
export function requireNonTestScheduleWrites() {
  if(isTestPreviewRequested())throw new ScheduleError(403,'TEST_PREVIEW_READ_ONLY','Backend preview kiểm thử không cho lưu hoặc công bố lịch.');
}
export const testPreviewWriteGuard:RequestHandler=(req,res,next)=>{
  if(isTestPreviewRequested()&&!['GET','HEAD','OPTIONS'].includes(req.method)&&
    !(req.method==='POST'&&['/preview','/test-preview'].includes(req.path))) {
    return res.status(403).json({status:'error',code:'TEST_PREVIEW_READ_ONLY',message:'Backend preview kiểm thử không cho ghi nhu cầu, lưu, gửi duyệt hoặc công bố lịch.'});
  }
  next();
};
