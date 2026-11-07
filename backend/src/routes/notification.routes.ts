import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { supabaseAdmin } from '../config/supabase.js';

export const notificationRoutes = Router();
notificationRoutes.use(authenticate);
notificationRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// Delivery status is not a read receipt. Reading the bell never changes DB state.
notificationRoutes.get('/', async (req, res) => {
  if (Object.keys(req.query).length) return res.status(400).json({ status: 'error', message: 'Yêu cầu không hợp lệ.' });
  try {
    const { data, error } = await supabaseAdmin.from('notifications')
      .select('id,type,title,content,created_at')
      .eq('recipient_id', req.user!.id)
      .order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return res.json({ status: 'ok', result: data ?? [] });
  } catch {
    return res.status(503).json({ status: 'error', message: 'Chưa tải được thông báo. Vui lòng thử lại.' });
  }
});
