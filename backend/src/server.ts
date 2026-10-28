import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Basic Root Route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Jollibee Shift Management API',
    description: 'MIS3047 - Quản lý quy trình kinh doanh (Nhóm 5)',
    status: 'online',
    docs: '/api/health'
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

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Backend] Server is running at http://localhost:${PORT}`);
    console.log(`[Backend] Health check endpoint: http://localhost:${PORT}/api/health`);
  });
}

export default app;
