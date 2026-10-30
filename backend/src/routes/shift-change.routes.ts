import { Router, type Request, type Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { SupabaseShiftChangeRepository } from '../repositories/shift-change.repository.js';
import { ShiftChangeService } from '../services/shift-change.service.js';
import { ShiftChangeError, type ShiftChangeAction } from '../types/shift-change.types.js';

export function createShiftChangeRouter(service = new ShiftChangeService(new SupabaseShiftChangeRepository())) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(authenticate, requireRole(['NV', 'QL']));
  const handle = (action: ShiftChangeAction, created = false) => async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.query).length) throw new ShiftChangeError(400, 'INVALID_INPUT', 'API chưa hỗ trợ bộ lọc truy vấn.');
      const result = await service.execute(action, req.user!, req.params.id, req.body ?? {});
      return res.status(created ? 201 : 200).json({ status: 'ok', result });
    } catch (err) {
      const error = err instanceof ShiftChangeError ? err : new ShiftChangeError(503, 'SHIFT_CHANGE_UNAVAILABLE', 'Không thể xử lý đổi ca. Hãy tải lại dữ liệu.');
      return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
    }
  };
  router.get('/assignments/:id/candidates', requireRole(['NV']), handle('candidates'));
  router.get('/assignments', requireRole(['NV']), handle('assignments'));
  router.get('/invitations', requireRole(['NV']), handle('invitations'));
  router.get('/', handle('requests'));
  router.post('/', requireRole(['NV']), handle('create', true));
  router.post('/invitations/:id/response', requireRole(['NV']), handle('respond'));
  router.post('/:id/decision', requireRole(['QL']), handle('decision'));
  router.post('/:id/refresh', requireRole(['QL']), handle('refresh'));
  return router;
}
export default createShiftChangeRouter();
