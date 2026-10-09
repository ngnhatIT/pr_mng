import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { asyncHandler } from '../../shared/http';
import { listTrials, TRIAL_STATUS } from './trials.service';

const router = Router();

/** Danh sách đăng ký học thử */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      status = '',
      page,
      limit,
    } = req.query as {
      status?: string;
      page?: string;
      limit?: string;
    };
    res.json(listTrials(reqCenterId(req), { status }, { page, limit }));
  })
);

/** Cập nhật trạng thái */
router.put(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const { status } = req.body as { status?: string };
    if (!status || !(TRIAL_STATUS as readonly string[]).includes(status)) {
      res.status(400).json({ error: 'Trạng thái không hợp lệ' });
      return;
    }
    const trial = db.prepare('SELECT id, center_id FROM trial_registrations WHERE id = ?').get(id) as
      { id: number; center_id: number | null } | undefined;
    if (!trial || (cid !== null && trial.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đăng ký học thử' });
      return;
    }
    db.prepare('UPDATE trial_registrations SET status = ? WHERE id = ?').run(status, id);
    res.json(db.prepare('SELECT * FROM trial_registrations WHERE id = ?').get(id));
  })
);

function genStudentCode(): string {
  for (let i = 0; i < 10; i++) {
    const code = `HV${Date.now().toString().slice(-6)}`;
    const exists = db.prepare('SELECT 1 FROM students WHERE code = ?').get(code);
    if (!exists) return code;
  }
  return `HV${Date.now().toString().slice(-8)}`;
}

/** Chuyển đăng ký học thử thành học viên chính thức */
router.post(
  '/:id/convert',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const trial = db.prepare('SELECT * FROM trial_registrations WHERE id = ?').get(id) as
      | {
          id: number;
          center_id: number | null;
          name: string;
          phone: string;
          class_id: number | null;
          referral_code: string | null;
          status: string;
        }
      | undefined;
    if (!trial || (cid !== null && trial.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đăng ký học thử' });
      return;
    }
    const { class_id } = req.body as { class_id?: number };
    let enrollClassId: number | null = null;
    if (class_id) {
      const cls = db.prepare('SELECT id, center_id FROM classes WHERE id = ?').get(Number(class_id)) as
        { id: number; center_id: number | null } | undefined;
      if (!cls || (cid !== null && cls.center_id !== cid)) {
        res.status(404).json({ error: 'Không tìm thấy lớp học' });
        return;
      }
      enrollClassId = cls.id;
    } else if (trial.class_id) {
      enrollClassId = trial.class_id;
    }

    const code = genStudentCode();
    const tx = db.transaction(() => {
      const r = db
        .prepare(
          "INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)"
        )
        .run(code, trial.name, trial.phone, trial.center_id);
      const studentId = Number(r.lastInsertRowid);
      if (enrollClassId) {
        db.prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)').run(
          studentId,
          enrollClassId
        );
      }
      db.prepare("UPDATE trial_registrations SET status = 'converted' WHERE id = ?").run(id);
      // Gắn referral đang chờ theo SĐT (nếu trial đăng ký bằng mã giới thiệu)
      if (trial.referral_code && trial.phone) {
        db.prepare(
          "UPDATE referrals SET referred_student_id = ? WHERE referred_phone = ? AND status = 'pending' AND referred_student_id IS NULL"
        ).run(studentId, trial.phone);
      }
      return studentId;
    });
    const studentId = tx();
    res.json({ ok: true, student_id: studentId });
  })
);

export default router;
