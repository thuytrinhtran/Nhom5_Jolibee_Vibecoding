import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
export const automationRoutes = Router();
automationRoutes.post('/run', async (req, res) => {
  const secret = process.env.REGISTRATION_AUTOMATION_TOKEN;
  const provided = req.headers.authorization || '';
  const expected = `Bearer ${secret || ''}`;
  if (!secret || secret.length < 32) return res.status(503).json({ status: 'error', message: 'Automation chưa được cấu hình.' });
  if (Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return res.status(401).json({ status: 'error', message: 'Không có quyền kích hoạt automation.' });
  if (Array.isArray(req.body) || Object.keys(req.body || {}).length) return res.status(400).json({ status: 'error', message: 'Automation dùng thời gian máy chủ, không nhận tham số.' });
  try {
    const { data, error } = await supabaseAdmin.rpc('run_registration_automation');
    if (error) throw error;
    res.json({ status: 'ok', result: data });
  } catch {
    res.status(503).json({ status: 'error', message: 'Automation thất bại. Kiểm tra migration và cấu hình.' });
  }
});
