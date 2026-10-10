import { Router, Response } from 'express';
import { db, setCenterSetting, toISODate, addDays } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { withAdvisoryLock } from '../../shared/advisoryLock';
import { paramId } from '../../shared/validate';
import { requirePermission } from '../authorization/authorization.middleware';
import {
  getZaloConfig,
  maskAccessToken,
  normalizePhone,
  sendZNS,
  sendTuitionReminder,
  ZALO_CONFIG_KEYS,
} from '../../services/zalo';
import { costlyOpRateLimit } from '../../middleware/rateLimit';
import { requireFeature } from '../../middleware/requireFeature';
import { runReminderOnce } from '../../jobs/reminderScheduler';
import { getDefaultCenter } from '../../utils/plans';
import { asyncHandler } from '../../shared/http';

const router = Router();

/** center_id hiệu lực cho cấu hình Zalo: center của user, superadmin dùng trung tâm mặc định */
const cidOf = async (req: AuthRequest): Promise<number | undefined> =>
  reqCenterId(req) ?? (await getDefaultCenter())?.id;

/* ------------------------- Cấu hình Zalo (admin) ------------------------- */

// GET /api/zalo/config
router.get(
  '/zalo/config',
  requirePermission('notifications.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cfg = await getZaloConfig(await cidOf(req));
    res.json({
      ...cfg,
      zalo_access_token: maskAccessToken(cfg.zalo_access_token),
      zalo_refresh_token: maskAccessToken(cfg.zalo_refresh_token),
      zalo_app_secret: maskAccessToken(cfg.zalo_app_secret),
    });
  })
);

// PUT /api/zalo/config
router.put(
  '/zalo/config',
  requirePermission('notifications.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = await cidOf(req);
    if (cid === undefined) {
      res.status(400).json({ error: 'Chưa có trung tâm nào để lưu cấu hình', code: 'BAD_REQUEST' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    // Cảnh báo (không chặn): Zalo khuyến nghị chỉ gửi tin 07:00-21:00
    let hourWarning: string | null = null;
    for (const k of ZALO_CONFIG_KEYS) {
      if (body[k] === undefined) continue;
      let v = String(body[k] ?? '');
      if (k === 'reminder_hour' && v) {
        const m = /^(\d{2}):(\d{2})$/.exec(v);
        const hh = m ? Number(m[1]) : -1;
        const mm = m ? Number(m[2]) : -1;
        if (!m || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          res.status(400).json({ error: 'Giờ nhắc phải có dạng HH:MM (00:00-23:59)', code: 'BAD_REQUEST' });
          return;
        }
        if (hh < 7 || hh >= 21) {
          hourWarning = `Giờ nhắc ${v} nằm ngoài khung 07:00-21:00, tin nhắn có thể làm phiền phụ huynh.`;
        }
      }
      if ((k === 'reminder_overdue_days' || k === 'reminder_upcoming_days') && v) {
        const n = Number(v);
        if (Number.isNaN(n) || n < 0 || n > 60) {
          res.status(400).json({ error: 'Số ngày nhắc phải từ 0 đến 60', code: 'BAD_REQUEST' });
          return;
        }
        v = String(Math.floor(n));
      }
      if (k === 'zalo_enabled') v = v === '1' ? '1' : '0';
      await setCenterSetting(cid, k, v.trim());
    }
    const cfg = await getZaloConfig(cid);
    res.json({
      ...cfg,
      zalo_access_token: maskAccessToken(cfg.zalo_access_token),
      ...(hourWarning ? { warning: hourWarning } : {}),
      zalo_refresh_token: maskAccessToken(cfg.zalo_refresh_token),
      zalo_app_secret: maskAccessToken(cfg.zalo_app_secret),
    });
  })
);

/* --------------------------- Gửi tin nhắn thử (admin) --------------------------- */

// POST /api/zalo/test { phone } — tốn tiền thật, giới hạn 5/15ph
router.post(
  '/zalo/test',
  costlyOpRateLimit,
  requireFeature('zalo_auto'),
  requirePermission('notifications.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = await cidOf(req);
    const cfg = await getZaloConfig(cid);
    const phone = normalizePhone(req.body?.phone as string | undefined);
    if (!phone) {
      res.status(400).json({ error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)', code: 'VALIDATION_INVALID' });
      return;
    }
    const templateData = {
      ten_trung_tam: cfg.center_name,
      ten_hoc_vien: 'Nguyễn Văn Test',
      so_tien: '1.500.000đ',
      han_nop: toISODate(addDays(new Date(), 7)).split('-').reverse().join('/'),
      ma_hoa_don: 'HD-TEST',
    };
    const demoMessage =
      `[${cfg.center_name}] NHẮC NỘP HỌC PHÍ (tin nhắn thử)\n` +
      `Kính gửi phụ huynh/học viên Nguyễn Văn Test,\n` +
      `Học phí 1.500.000đ (mã HD-TEST) đến hạn nộp ngày ${templateData.han_nop}.\n` +
      `Quý khách vui lòng hoàn tất học phí sớm. Xin cảm ơn!`;

    const insertLog = await db.prepare(
      'INSERT INTO reminders (center_id, invoice_id, student_id, phone, kind, status, message, response) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)'
    );

    // Chế độ demo: chưa có token hoặc chưa bật
    if (cfg.zalo_enabled !== '1' || !cfg.zalo_access_token) {
      await insertLog.run(cid ?? null, phone, 'general', 'demo', demoMessage, null);
      res.json({
        demo: true,
        status: 'demo',
        message: `Chế độ demo — đã ghi log tin nhắn thử tới ${phone}. Cấu hình Access Token để gửi ZNS thật.`,
      });
      return;
    }
    if (!cfg.zalo_template_upcoming) {
      res.status(400).json({ error: 'Chưa cấu hình Template ID cho tin nhắn sắp đến hạn', code: 'BAD_REQUEST' });
      return;
    }
    const r = await sendZNS({
      phone,
      templateId: cfg.zalo_template_upcoming,
      templateData,
      accessToken: cfg.zalo_access_token,
    });
    const status = r.ok ? 'sent' : 'failed';
    await insertLog.run(
      cid ?? null,
      phone,
      'general',
      status,
      r.ok ? demoMessage : r.error || 'Gửi thất bại',
      r.data ? JSON.stringify(r.data).slice(0, 2000) : r.error || null
    );
    if (r.ok) {
      res.json({ demo: false, status: 'sent', message: `Đã gửi tin nhắn thử tới ${phone}` });
    } else {
      res
        .status(502)
        .json({ error: `Gửi thất bại: ${r.error}`, code: 'ZALO_SEND_FAILED', demo: false, status: 'failed' });
    }
  })
);

/* --------------------------- Chạy lịch nhắc ngay (admin) --------------------------- */

// POST /api/zalo/run-once — sweep toàn bộ nhắc nợ, tốn DB + tiền, giới hạn 5/15ph
router.post(
  '/zalo/run-once',
  costlyOpRateLimit,
  requireFeature('zalo_auto'),
  requirePermission('notifications.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const r = await runReminderOnce(await cidOf(req));
    if (r.wasLocked) {
      res.status(409).json({
        ok: false,
        code: 'ALREADY_RUNNING',
        message: 'Có phiên bản khác đang chạy, vui lòng thử lại sau',
      });
      return;
    }
    res.json({
      ok: true,
      overdue: r.overdue,
      upcoming: r.upcoming,
      skipped: r.skipped,
      message: `Đã xử lý: ${r.overdue} quá hạn, ${r.upcoming} sắp đến hạn, ${r.skipped} bỏ qua (đã nhắc gần đây)`,
    });
  })
);

/* ------------------------------- Lịch sử nhắc ------------------------------- */

// GET /api/reminders?limit=100 — lọc theo trung tâm (superadmin xem tất cả)
router.get(
  '/reminders',
  requirePermission('notifications.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    // Lọc center cho cả 2 nhánh: row có student và row student_id NULL (dùng r.center_id)
    const where = cid !== null ? 'WHERE (s.center_id = ? OR (r.student_id IS NULL AND r.center_id = ?))' : '';
    const rows = await db
      .prepare(
        `SELECT r.*, s.name as student_name, s.code as student_code, i.amount as invoice_amount, i.due_date
       FROM reminders r
       LEFT JOIN students s ON s.id = r.student_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
       ${where}
       ORDER BY r.id DESC LIMIT ?`
      )
      .all(...(cid !== null ? [cid, cid] : []), limit);
    res.json(rows);
  })
);

/* --------------------------- Gửi nhắc thủ công 1 hóa đơn --------------------------- */

// POST /api/invoices/:id/remind { kind: 'overdue' | 'upcoming' }
// Gửi tin thật (tốn tiền) — bypass anti-spam của scheduler nên giới hạn riêng 5/15ph
router.post(
  '/invoices/:id/remind',
  costlyOpRateLimit,
  requireFeature('zalo_auto'),
  requirePermission('notifications.send'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    if (cid !== null) {
      const inv = await db
        .prepare(
          'SELECT i.id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ? AND s.center_id = ?'
        )
        .get(id, cid);
      if (!inv) {
        res.status(404).json({ error: 'Không tìm thấy hóa đơn', code: 'NOT_FOUND' });
        return;
      }
    }
    const kind = req.body?.kind === 'upcoming' ? 'upcoming' : 'overdue';
    // Anti-spam: không gửi lại cùng loại trong 1 giờ (endpoint thủ công bypass dedupe 3 ngày của scheduler)
    // Dùng advisory lock để chống race: 2 request đồng thời chỉ 1 được gửi
    const lockKey = `remind:${id}:${kind}`;
    const lockOutcome = await withAdvisoryLock(lockKey, async () => {
      const recent = (await db
        .prepare(
          `SELECT 1 FROM reminders
           WHERE invoice_id = ? AND kind = ? AND created_at >= datetime('now', '-1 hour')
           LIMIT 1`
        )
        .get(id, kind)) as { '1'?: number } | undefined;
      if (recent) {
        res.status(429).json({
          error: 'Hóa đơn này vừa được nhắc trong 1 giờ qua. Vui lòng thử lại sau.',
          code: 'REMINDER_COOLDOWN',
        });
        return;
      }
      const r = await sendTuitionReminder(id, kind, cid ?? undefined);
      return r;
    });
    if (lockOutcome.status === 'locked') {
      res.status(429).json({
        error: 'Đang có yêu cầu nhắc khác cho hóa đơn này. Vui lòng thử lại sau.',
        code: 'REMINDER_IN_PROGRESS',
      });
      return;
    }
    if (lockOutcome.status === 'error') throw lockOutcome.error;
    res.json(lockOutcome.result);
  })
);
export default router;
