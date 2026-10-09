import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { requireAuth, denyParents, reqCenterId, AuthRequest } from './middleware/auth';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler, notFoundHandler, asyncHandler } from './shared/http';
import { getUploadDir } from './shared/upload';
import { checkUploadAccess } from './shared/uploadAccess';
import { registerZaloListeners } from './shared/events/zalo.listeners';
import { apiRateLimit, writeRateLimit, parentRateLimit, fileServeRateLimit } from './middleware/rateLimit';
import { db } from './db';
import { env } from './config/env';
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
import rolesRoutes from './modules/authorization/roles.routes';

/**
 * Factory tạo Express app.
 * Tách khỏi index.ts để có thể import trong test mà không khởi động server.
 */
export function createApp(): Express {
  const app = express();

  app.use(requestId); // Gán X-Request-Id cho mọi request (trace logs)
  app.use(requestLogger); // Log method/path/status/duration + đếm metrics
  // M5: CORS allowlist + credentials (thay vì cors() mở toàn bộ) + security headers
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      credentials: true,
    })
  );
  app.use(helmet());
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  setupSwagger(app); // Swagger UI tại /api/docs
  registerZaloListeners(); // Event-driven: Zalo notifications qua domain events

  // Phục vụ client đã build (production 1 lệnh duy nhất)
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // Phục vụ file bài nộp — CÓ AUTH (ảnh bài làm của học viên, không public)
  // + rate limit riêng (route này bypass các limiter của /api/v1)
  const uploadDir = getUploadDir();
  app.get(
    '/uploads/:filename',
    fileServeRateLimit,
    (req, res, next) => {
      // Cho phép token qua query ?token= (vì <img>/<a> không gửi header)
      const qToken = req.query.token as string | undefined;
      if (qToken && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${qToken}`;
      }
      next();
    },
    requireAuth,
    asyncHandler(async (req, res) => {
      const authReq = req as AuthRequest;
      // C3: PHẢI await — nếu không, check quyền bị bỏ qua hoàn toàn
      await checkUploadAccess(
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

  // Health check CÔNG KHAI — M11: chỉ trả {ok, time}, KHÔNG lộ version PG/heap.
  // PHẢI đứng trước mọi mount có requireAuth.
  app.get('/api/health', (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Health check CHI TIẾT (DB, disk, memory) — yêu cầu đăng nhập.
  // Mount trên v1 router → /api/v1/health (legacy /api/health vẫn trúng route public ở trên nhờ thứ tự đăng ký).
  v1.get('/health', requireAuth, async (_req: express.Request, res: express.Response) => {
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
  });

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
  v1.use('/payroll', ...staff, payrollRoutes); // C1: denyParents — parent không chạm API lương
  v1.use('/trials', ...staff, trialRoutes);
  v1.use('/teacher', ...staff, teacherPortalRoutes); // C1: denyParents — parent không chạm portal giáo viên
  v1.use('/leads', ...staff, leadRoutes);
  v1.use('/referrals', ...staff, referralRoutes);
  v1.use('/reviews', ...staff, reviewRoutes);
  v1.use('/centers', ...staff, centerRoutes); // C1: denyParents + superadminOnly nội bộ (requirePermission('system.manage'))
  v1.use('/audit-logs', requireAuth, denyParents, auditRoutes); // adminOnly nội bộ
  v1.use('/metrics', requireAuth, denyParents, metricsRoutes); // adminOnly: Prometheus metrics
  v1.use('/roles', requireAuth, denyParents, rolesRoutes); // quản trị phân quyền

  // Mount versioned API + legacy alias (backward compat với client cũ)
  app.use('/api/v1', v1);
  app.use(
    '/api',
    (req, res, next) => {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT');
      next();
    },
    v1
  );

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
