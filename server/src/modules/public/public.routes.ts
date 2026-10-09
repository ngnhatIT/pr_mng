import { Router, Request, Response } from 'express';
import { db, formatSchedule } from '../../db';
import { publicRateLimit } from '../../middleware/rateLimit';
import { resolvePublicCenter, hasFeature, effectivePlan, Center } from '../../utils/plans';
import { normalizePhone } from '../../services/zalo';
import { asyncHandler } from '../../shared/http';

const router = Router();

/** Chặn các trang landing nếu trung tâm chưa có tính năng 'landing' */
async function landingCenter(req: Request, res: Response): Promise<Center | undefined> {
  const center = await resolvePublicCenter(req);
  if (!center || !hasFeature(center, 'landing')) {
    res.status(403).json({ error: 'Trung tâm chưa kích hoạt trang công khai' });
    return undefined;
  }
  return center;
}

/* ------------------------- Trang công khai ------------------------- */

// GET /api/public/center
router.get(
  '/center',
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    res.json({
      id: center.id,
      name: center.name,
      phone: center.phone,
      address: center.address,
      plan: effectivePlan(center),
    });
  })
);

// GET /api/public/classes
router.get(
  '/classes',
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    const rows = (await db
      .prepare(
        `SELECT c.id, c.name, t.name as teacher_name, c.schedule, c.tuition_fee, r.name as room_name,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') as student_count
       FROM classes c
       LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE c.center_id = ? AND c.status = 'active'
       ORDER BY c.name ASC`
      )
      .all(center.id)) as {
      id: number;
      name: string;
      teacher_name: string | null;
      schedule: string;
      tuition_fee: number;
      room_name: string | null;
      student_count: number;
    }[];
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        teacher_name: r.teacher_name,
        schedule_text: formatSchedule(r.schedule),
        tuition_fee: r.tuition_fee,
        student_count: r.student_count,
        room_name: r.room_name,
      }))
    );
  })
);

// GET /api/public/teachers
router.get(
  '/teachers',
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    const rows = await db
      .prepare('SELECT id, name, subject FROM teachers WHERE center_id = ? ORDER BY name ASC')
      .all(center.id);
    res.json(rows);
  })
);

// GET /api/public/reviews
router.get(
  '/reviews',
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    const items = await db
      .prepare(
        `SELECT r.id, r.rating, r.comment, p.name as parent_name, r.created_at
       FROM reviews r
       LEFT JOIN parents p ON p.id = r.parent_id
       WHERE r.center_id = ? AND r.status = 'approved'
       ORDER BY r.id DESC LIMIT 20`
      )
      .all(center.id);
    const agg = (await db
      .prepare(
        "SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*) as total FROM reviews WHERE center_id = ? AND status = 'approved'"
      )
      .get(center.id)) as { avg: number; total: number };
    res.json({
      avg: Math.round(Number(agg.avg) * 10) / 10,
      total: agg.total,
      items,
    });
  })
);

/* ------------------------- Lead & đăng ký học thử ------------------------- */

// POST /api/public/leads
router.post(
  '/leads',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    const center = await resolvePublicCenter(req);
    if (!center) {
      res.status(404).json({ error: 'Không xác định được trung tâm' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const phone = normalizePhone(body?.phone as string | undefined);
    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập họ tên' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'Họ tên tối đa 100 ký tự' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)' });
      return;
    }
    const source = body?.source ? String(body.source).trim().slice(0, 50) : null;
    const note = body?.note ? String(body.note).trim().slice(0, 1000) : null;
    await db
      .prepare(
        "INSERT INTO leads (center_id, name, phone, source, status, note) VALUES (?, ?, ?, ?, 'new', ?)"
      )
      .run(center.id, name, phone, source, note);
    res.status(201).json({ ok: true });
  })
);

// POST /api/public/trials
router.post(
  '/trials',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    const center = await resolvePublicCenter(req);
    if (!center) {
      res.status(404).json({ error: 'Không xác định được trung tâm' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const phone = normalizePhone(body?.phone as string | undefined);
    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập họ tên' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)' });
      return;
    }
    let classId: number | null = null;
    if (body?.class_id !== undefined && body?.class_id !== null && String(body.class_id).trim() !== '') {
      classId = Number(body.class_id);
      if (!Number.isInteger(classId)) {
        res.status(400).json({ error: 'Lớp học không hợp lệ' });
        return;
      }
      const cls = await db
        .prepare('SELECT id FROM classes WHERE id = ? AND center_id = ?')
        .get(classId, center.id);
      if (!cls) {
        res.status(400).json({ error: 'Lớp học không tồn tại' });
        return;
      }
    }
    const referralCode = body?.referral_code ? String(body.referral_code).trim() : '';
    let referrer: { id: number; phone: string | null } | undefined;
    if (referralCode) {
      referrer = (await db
        .prepare('SELECT id, phone FROM parents WHERE referral_code = ? AND center_id = ?')
        .get(referralCode, center.id)) as { id: number; phone: string | null } | undefined;
      // Chặn tự giới thiệu chính mình: SĐT đăng ký trùng SĐT của referrer
      if (referrer && normalizePhone(referrer.phone) === phone) {
        res.status(400).json({ error: 'Không thể dùng mã giới thiệu của chính mình' });
        return;
      }
    }
    const desiredDate = body?.desired_date ? String(body.desired_date).trim() : null;
    const note = body?.note ? String(body.note).trim() : null;
    await db
      .prepare(
        "INSERT INTO trial_registrations (center_id, name, phone, class_id, desired_date, note, referral_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')"
      )
      .run(center.id, name, phone, classId, desiredDate, note, referralCode || null);
    if (referrer) {
      // Không tạo referral pending trùng SĐT (tránh rows rác tích tụ)
      const existing = await db
        .prepare(
          "SELECT 1 FROM referrals WHERE referrer_parent_id = ? AND referred_phone = ? AND status = 'pending'"
        )
        .get(referrer.id, phone);
      if (!existing) {
        await db
          .prepare(
            "INSERT INTO referrals (referrer_parent_id, referred_phone, referred_student_id, status) VALUES (?, ?, NULL, 'pending')"
          )
          .run(referrer.id, phone);
      }
    }
    res.status(201).json({ ok: true });
  })
);

export default router;
