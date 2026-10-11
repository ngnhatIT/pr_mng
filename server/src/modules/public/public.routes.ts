import { Router, Request, Response } from 'express';
import { publicRateLimit } from '../../middleware/rateLimit';
import { resolvePublicCenter, hasFeature, effectivePlan, Center } from '../../utils/plans';
import { normalizePhone } from '../../services/zalo';
import { asyncHandler } from '../../shared/http';
import { v, validate } from '../../shared/validate';
import {
  listPublicClasses,
  listPublicTeachers,
  getPublicReviews,
  createPublicLead,
  createPublicTrial,
} from './public.service';

const router = Router();

/** Chặn các trang landing nếu trung tâm chưa có tính năng 'landing' */
async function landingCenter(req: Request, res: Response): Promise<Center | undefined> {
  const center = await resolvePublicCenter(req);
  if (!center) {
    res.status(404).json({ error: 'Không xác định được trung tâm', code: 'NOT_FOUND' });
    return undefined;
  }
  if (!hasFeature(center, 'landing')) {
    res.status(403).json({ error: 'Trung tâm chưa kích hoạt trang công khai', code: 'FORBIDDEN' });
    return undefined;
  }
  return center;
}

/* ------------------------- Trang công khai ------------------------- */

// GET /api/public/center
router.get(
  '/center',
  publicRateLimit(20),
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
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    res.json(await listPublicClasses(center.id));
  })
);

// GET /api/public/teachers
router.get(
  '/teachers',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    res.json(await listPublicTeachers(center.id));
  })
);

// GET /api/public/reviews
router.get(
  '/reviews',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    const center = await landingCenter(req, res);
    if (!center) return;
    res.json(await getPublicReviews(center.id));
  })
);

/* ------------------------- Lead & đăng ký học thử ------------------------- */

// POST /api/public/leads
router.post(
  '/leads',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    // Form công khai cũng chịu gate 'landing' như các GET (gói basic không có trang công khai)
    const center = await landingCenter(req, res);
    if (!center) return;
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const phone = normalizePhone(body?.phone as string | undefined);
    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập họ tên', code: 'BAD_REQUEST' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'Họ tên tối đa 100 ký tự', code: 'BAD_REQUEST' });
      return;
    }
    if (!phone) {
      res.status(400).json({
        error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)',
        code: 'VALIDATION_INVALID',
      });
      return;
    }
    const source = body?.source ? String(body.source).trim().slice(0, 50) : null;
    const note = body?.note ? String(body.note).trim().slice(0, 1000) : null;
    await createPublicLead(center.id, { name, phone, source, note });
    res.status(201).json({ ok: true });
  })
);

// POST /api/public/trials
router.post(
  '/trials',
  publicRateLimit(20),
  asyncHandler(async (req: Request, res: Response) => {
    // Form công khai cũng chịu gate 'landing' như các GET (gói basic không có trang công khai)
    const center = await landingCenter(req, res);
    if (!center) return;
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '')
      .trim()
      .slice(0, 100);
    const phone = normalizePhone(body?.phone as string | undefined);
    const note = body?.note ? String(body.note).trim().slice(0, 1000) : null;
    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập họ tên', code: 'BAD_REQUEST' });
      return;
    }
    if (!phone) {
      res.status(400).json({
        error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)',
        code: 'VALIDATION_INVALID',
      });
      return;
    }
    let classId: number | null = null;
    if (body?.class_id !== undefined && body?.class_id !== null && String(body.class_id).trim() !== '') {
      classId = Number(body.class_id);
      if (!Number.isInteger(classId)) {
        res.status(400).json({ error: 'Lớp học không hợp lệ', code: 'VALIDATION_INVALID' });
        return;
      }
    }
    const referralCode = body?.referral_code ? String(body.referral_code).trim().slice(0, 32) : '';
    const desiredDateRaw = body?.desired_date ? String(body.desired_date).trim() : null;
    // Validate ngày thật (tránh "2026-13-99" lọt vào DB)
    let desiredDate: string | null = null;
    if (desiredDateRaw) {
      const parsed = validate({ d: desiredDateRaw }, { d: v.date({ label: 'Ngày mong muốn' }) });
      desiredDate = parsed.d ?? null;
    }
    await createPublicTrial(center.id, { name, phone, note, classId, desiredDate, referralCode });
    res.status(201).json({ ok: true });
  })
);

export default router;
