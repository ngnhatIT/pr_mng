import { Router, Response } from 'express';
import { setCenterSetting, toISODate, addDays } from '../../db';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { paramId } from '../../shared/validate';
import { requirePermission } from '../authorization/authorization.middleware';
import {
  getZaloConfig,
  maskAccessToken,
  normalizePhone,
  sendZNS,
  ZALO_CONFIG_KEYS,
  isKeepSecret,
  logTestReminder,
  listReminders,
  sendManualReminder,
} from '../../services/zalo';
import { costlyOpRateLimit } from '../../middleware/rateLimit';
import { requireFeature } from '../../middleware/requireFeature';
import { runReminderOnce } from '../../jobs/reminderScheduler';
import { asyncHandler } from '../../shared/http';

const router = Router();

/** center_id hiệu lực cho cấu hình Zalo — ARCH-1: superadmin phải chỉ rõ center_id (không rơi vào tenant #1) */
const cidOf = (req: AuthRequest): number => requireCenterId(req);

/* ------------------------- Cấu hình Zalo (admin) ------------------------- */

// GET /api/zalo/config
router.get(
  '/zalo/config',
  requirePermission('notifications.manage', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cfg = await getZaloConfig(cidOf(req));
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
  requirePermission('notifications.manage', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = cidOf(req);
    const body = req.body as Record<string, unknown>;
    // Cảnh báo (không chặn): Zalo khuyến nghị chỉ gửi tin 07:00-21:00
    let hourWarning: string | null = null;
    const updates: [string, string][] = [];
    for (const k of ZALO_CONFIG_KEYS) {
      if (body[k] === undefined) continue;
      let v = String(body[k] ?? '');
      // DATA-5/ADM-2/ADM-9: secret đã che hoặc rỗng = giữ nguyên, không ghi đè token/secret thật
      if (isKeepSecret(k, v)) continue;
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
      updates.push([k, v.trim()]);
    }
    // Validate hết rồi mới ghi (không lưu dở dang khi 1 trường sai)
    for (const [k, v] of updates) await setCenterSetting(cid, k, v);
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
  requirePermission('notifications.manage', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = cidOf(req);
    const cfg = await getZaloConfig(cid);
    const phone = normalizePhone(req.body?.phone as string | undefined);
    if (!phone) {
      res.status(400).json({
        error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)',
        code: 'VALIDATION_INVALID',
      });
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

    // Chế độ demo: chưa có token hoặc chưa bật
    if (cfg.zalo_enabled !== '1' || !cfg.zalo_access_token) {
      await logTestReminder(cid, phone, 'demo', demoMessage, null);
      res.json({
        demo: true,
        status: 'demo',
        message: `Chế độ demo — đã ghi log tin nhắn thử tới ${phone}. Cấu hình Access Token để gửi ZNS thật.`,
      });
      return;
    }
    if (!cfg.zalo_template_upcoming) {
      res
        .status(400)
        .json({ error: 'Chưa cấu hình Template ID cho tin nhắn sắp đến hạn', code: 'BAD_REQUEST' });
      return;
    }
    const r = await sendZNS({
      phone,
      templateId: cfg.zalo_template_upcoming,
      templateData,
      accessToken: cfg.zalo_access_token,
    });
    const status = r.ok ? 'sent' : 'failed';
    await logTestReminder(
      cid,
      phone,
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
  requirePermission('notifications.manage', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const r = await runReminderOnce(cidOf(req));
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
  requirePermission('notifications.view', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json(await listReminders(cid, limit));
  })
);

/* --------------------------- Gửi nhắc thủ công 1 hóa đơn --------------------------- */

// POST /api/invoices/:id/remind { kind: 'overdue' | 'upcoming' }
// Gửi tin thật (tốn tiền) — bypass anti-spam của scheduler nên giới hạn riêng 5/15ph
router.post(
  '/invoices/:id/remind',
  costlyOpRateLimit,
  requireFeature('zalo_auto'),
  requirePermission('notifications.send', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const kind = req.body?.kind === 'upcoming' ? 'upcoming' : 'overdue';
    const lockOutcome = await sendManualReminder(cid, id, kind);
    if (lockOutcome.status === 'locked') {
      res.status(429).json({
        error: 'Đang có yêu cầu nhắc khác cho hóa đơn này. Vui lòng thử lại sau.',
        code: 'REMINDER_IN_PROGRESS',
      });
      return;
    }
    if (lockOutcome.status === 'error') throw lockOutcome.error;
    if (lockOutcome.result === 'cooldown') {
      res.status(429).json({
        error: 'Hóa đơn này vừa được nhắc trong 1 giờ qua. Vui lòng thử lại sau.',
        code: 'REMINDER_COOLDOWN',
      });
      return;
    }
    res.json(lockOutcome.result);
  })
);
export default router;
