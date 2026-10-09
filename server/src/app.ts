import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { requireAuth, denyParents, reqCenterId, AuthRequest } from './middleware/auth';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler, asyncHandler } from './shared/http';
import { getUploadDir } from './shared/upload';
import { checkUploadAccess } from './shared/uploadAccess';
import { registerZaloListeners } from './shared/events/zalo.listeners';
import { apiRateLimit, writeRateLimit, parentRateLimit } from './middleware/rateLimit';
import { db } from './db';
import { setupSwagger } from './docs/swagger';

/* Modules theo domain */
import authRoutes from './modules/auth/auth.routes';
import studentRoutes from './modules/students/students.routes';
import teacherRoutes from './modules/teachers/teachers.routes';
import classRoutes from './modules/classes/classes.routes';
import sessionRoutes from './modules/sessions/sessions.routes';
import invoiceRoutes from './modules/invoices/invoices.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import zaloRoutes from './modules/zalo/zalo.routes';
import parentRoutes from './modules/parent/parent.routes';
import paymentRoutes from './modules/payments/payments.routes';
import leaveRoutes from './modules/leaves/leaves.routes';
import gradeRoutes from './modules/grades/grades.routes';
import homeworkRoutes from './modules/homework/homework.routes';
import roomRoutes from './modules/rooms/rooms.routes';
import payrollRoutes from './modules/payroll/payroll.routes';
import trialRoutes from './modules/trials/trials.routes';
import teacherPortalRoutes from './modules/teacher/teacher.routes';
import publicRoutes from './modules/public/public.routes';
import leadRoutes from './modules/leads/leads.routes';
import referralRoutes from './modules/referrals/referrals.routes';
import reviewRoutes from './modules/reviews/reviews.routes';
import centerRoutes from './modules/centers/centers.routes';
import auditRoutes from './modules/audit/audit.routes';
import metricsRoutes from './modules/metrics/metrics.routes';

/**
 * Factory tạo Express app.
 * Tách khỏi index.ts để có thể import trong test mà không khởi động server.
 */
export function createApp(): Express {
  const app = express();

  app.use(requestId); // Gán X-Request-Id cho mọi request (trace logs)
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  setupSwagger(app); // Swagger UI tại /api/docs
  registerZaloListeners(); // Event-driven: Zalo notifications qua domain events

  // Phục vụ client đã build (production 1 lệnh duy nhất)
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // Phục vụ file bài nộp — CÓ AUTH (ảnh bài làm của học viên, không public)
  const uploadDir = getUploadDir();
  app.get(
    '/uploads/:filename',
    (req, res, next) => {
      // Cho phép token qua query ?token= (vì <img>/<a> không gửi header)
      const qToken = req.query.token as string | undefined;
      if (qToken && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${qToken}`;
      }
      next();
    },
    requireAuth,
    asyncHandler((req, res) => {
      const authReq = req as AuthRequest;
      checkUploadAccess(
        req.params.filename,
        authReq.user?.role,
        reqCenterId(authReq),
        authReq.user!.id,
        authReq.user?.parent_id
      );
      const filename = req.params.filename.split('/').pop() || '';
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.sendFile(path.join(uploadDir, filename), (err) => {
        if (err) res.status(404).json({ error: 'Không tìm thấy file' });
      });
    })
  );

  /* ------------------------- API v1 (versioned) ------------------------- */
  // Chuẩn enterprise: mọi API dưới /api/v1. Giữ /api như legacy alias (có deprecation header).
  const v1 = express.Router();

  // Rate limit global: 300 req / 15 phút / IP cho mọi endpoint versioned
  v1.use(apiRateLimit);
  // Write limiter: 60 req / 15 phút / IP cho POST/PUT/PATCH/DELETE
  v1.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      return writeRateLimit(req, res, next);
    }
    next();
  });

  v1.use('/auth', authRoutes);
  v1.use('/parent', parentRateLimit, parentRoutes); // register/login public, còn lại parentAuth bên trong
  v1.use('/public', publicRoutes); // API công khai cho landing (rate-limit bên trong)
  // vnpay-return public, còn lại requireAuth bên trong — PHẢI đứng trước các mount '/' có requireAuth
  v1.use('/payments', paymentRoutes);

  // Health check công khai — PHẢI đứng trước mọi mount có requireAuth.
  // Chuẩn enterprise: kiểm tra dependencies (DB, disk) chứ không chỉ "server còn sống".
  // Mount ở cả /api/health (legacy) và /api/v1/health (versioned).
  const healthHandler = async (_req: express.Request, res: express.Response) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    // DB: query đơn giản + version PostgreSQL
    try {
      await db.prepare('SELECT 1').get();
      const v = (await db.query('SHOW server_version')) as { rows: { server_version: string }[] };
      checks.database = { ok: true, detail: `postgresql ${v.rows[0].server_version}` };
    } catch (err) {
      checks.database = { ok: false, detail: String(err) };
    }
    // Disk: dung lượng trống thư mục uploads
    try {
      fs.accessSync(getUploadDir(), fs.constants.W_OK);
      checks.disk = { ok: true, detail: 'uploads writable' };
    } catch {
      checks.disk = { ok: false, detail: 'uploads not writable' };
    }
    // Memory
    const mem = process.memoryUsage();
    checks.memory = {
      ok: mem.heapUsed < 512 * 1024 * 1024,
      detail: `${Math.round(mem.heapUsed / 1024 / 1024)}MB heap`,
    };
    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({
      ok: allOk,
      time: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      checks,
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  /* ------------------------- Quản trị trung tâm ------------------------- */
  // denyParents: phụ huynh chỉ được dùng /api/parent, không chạm API nhân sự
  const staff = [requireAuth, denyParents];
  v1.use('/students', ...staff, studentRoutes);
  v1.use('/teachers', ...staff, teacherRoutes);
  v1.use('/classes', ...staff, classRoutes);
  v1.use('/', ...staff, sessionRoutes);
  v1.use('/invoices', ...staff, invoiceRoutes);
  v1.use('/dashboard', ...staff, dashboardRoutes);
  v1.use('/', ...staff, zaloRoutes);
  v1.use('/leaves', ...staff, leaveRoutes);
  v1.use('/grades', ...staff, gradeRoutes);
  v1.use('/homework', ...staff, homeworkRoutes);
  v1.use('/rooms', ...staff, roomRoutes);
  v1.use('/payroll', requireAuth, payrollRoutes); // staffOnly nội bộ
  v1.use('/trials', ...staff, trialRoutes);
  v1.use('/teacher', requireAuth, teacherPortalRoutes); // teacherOnly nội bộ
  v1.use('/leads', ...staff, leadRoutes);
  v1.use('/referrals', ...staff, referralRoutes);
  v1.use('/reviews', ...staff, reviewRoutes);
  v1.use('/centers', requireAuth, centerRoutes); // superadminOnly nội bộ
  v1.use('/audit-logs', requireAuth, denyParents, auditRoutes); // adminOnly nội bộ
  v1.use('/metrics', requireAuth, denyParents, metricsRoutes); // adminOnly: Prometheus metrics

  // Mount versioned API + legacy alias (backward compat với client cũ)
  app.use('/api/v1', v1);
  app.use('/api', (req, res, next) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT');
    next();
  }, v1);

  // SPA fallback cho client build
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  /* Xử lý lỗi tập trung — LUÔN đặt cuối cùng */
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
