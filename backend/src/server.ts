import { registrationReports } from './routes/registration-reports.routes.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import authRoutes from './routes/auth.routes.js';
import { registrationRoutes } from './routes/registration.routes.js';
import { automationRoutes } from './routes/registration-automation.routes.js';
import scheduleWorkflowRoutes from './routes/schedule-workflow.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use('/api/auth', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(express.json());


// Auth & RBAC Routes
app.use('/api/auth', authRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/registration-reports', registrationReports);
app.use('/api/internal/registration-automation', automationRoutes);
app.use('/api/schedules/workflow', scheduleWorkflowRoutes);

// Basic Root Route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Jollibee Shift Management API',
    description: 'MIS3047 - Quản lý quy trình kinh doanh (Nhóm 5)',
    status: 'online',
    docs: ['/api/health', '/api/db-health']
  });
});

// Health check endpoint required by Step 1
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Jollibee Shift Management API is running smoothly',
    timestamp: new Date().toISOString(),
    service: 'jollibee-scheduling-backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Database health check endpoint querying a real table from Jollishift.sql
app.get('/api/db-health', async (_req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    // Real SELECT query against public.branches
    const { data, error, count } = await supabase
      .from('branches')
      .select('id, name', { count: 'exact' })
      .limit(1);

    const latencyMs = Date.now() - startTime;

    if (error) {
      return res.status(500).json({
        status: 'error',
        database: 'disconnected',
        provider: 'supabase',
        table_checked: 'branches',
        error: error.message,
        code: error.code,
        latency_ms: latencyMs,
        timestamp: new Date().toISOString()
      });
    }

    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      provider: 'supabase',
      table_checked: 'branches',
      query: 'SELECT id, name FROM branches LIMIT 1',
      rows_found: count ?? (data ? data.length : 0),
      latency_ms: latencyMs,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      database: 'error',
      provider: 'supabase',
      error: err.message || 'Unknown database connection error',
      timestamp: new Date().toISOString()
    });
  }
});

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ status: 'error', message: 'API không tồn tại.' });
});
app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ status: 'error', message: status === 400 ? 'Nội dung JSON không hợp lệ.' : 'Không thể xử lý yêu cầu.' });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Backend] Server is running at http://localhost:${PORT}`);
    console.log(`[Backend] Health check endpoint: http://localhost:${PORT}/api/health`);
  });
}

export default app;
