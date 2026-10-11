import { db, formatSchedule } from '../../db';
import { AppError } from '../../shared/errors';
import { normalizePhone } from '../../services/zalo';
import { createReferral } from '../referrals/rewards.service';

/** Cửa sổ chống gửi trùng form công khai theo (trung tâm, SĐT đã chuẩn hóa). */
const DEDUPE_MINUTES = 10;

async function recentDuplicate(
  table: 'leads' | 'trial_registrations',
  centerId: number,
  phone: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM ${table} WHERE center_id = ? AND phone = ?
       AND created_at >= to_char(NOW() - INTERVAL '${DEDUPE_MINUTES} minutes', 'YYYY-MM-DD HH24:MI:SS') LIMIT 1`
    )
    .get(centerId, phone);
  return !!row;
}

/* ------------------------- Trang công khai ------------------------- */

export async function listPublicClasses(centerId: number) {
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
    .all(centerId)) as {
    id: number;
    name: string;
    teacher_name: string | null;
    schedule: string;
    tuition_fee: number;
    room_name: string | null;
    student_count: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    teacher_name: r.teacher_name,
    schedule_text: formatSchedule(r.schedule),
    tuition_fee: r.tuition_fee,
    student_count: r.student_count,
    room_name: r.room_name,
  }));
}

export async function listPublicTeachers(centerId: number) {
  return db
    .prepare('SELECT id, name, subject FROM teachers WHERE center_id = ? ORDER BY name ASC')
    .all(centerId);
}

export async function getPublicReviews(centerId: number) {
  const items = await db
    .prepare(
      `SELECT r.id, r.rating, r.comment, p.name as parent_name, r.created_at
       FROM reviews r
       LEFT JOIN parents p ON p.id = r.parent_id
       WHERE r.center_id = ? AND r.status = 'approved'
       ORDER BY r.id DESC LIMIT 20`
    )
    .all(centerId);
  const agg = (await db
    .prepare(
      "SELECT COALESCE(AVG(rating), 0) as avg, COUNT(*) as total FROM reviews WHERE center_id = ? AND status = 'approved'"
    )
    .get(centerId)) as { avg: number; total: number };
  return { avg: Math.round(Number(agg.avg) * 10) / 10, total: agg.total, items };
}

/* ------------------------- Lead & đăng ký học thử ------------------------- */

/** Lead từ form công khai. Chống spam/bấm lặp: cùng SĐT ở cùng trung tâm trong cửa sổ ngắn -> bỏ qua. */
export async function createPublicLead(
  centerId: number,
  d: { name: string; phone: string; source: string | null; note: string | null }
): Promise<void> {
  if (await recentDuplicate('leads', centerId, d.phone)) return;
  await db
    .prepare("INSERT INTO leads (center_id, name, phone, source, status, note) VALUES (?, ?, ?, ?, 'new', ?)")
    .run(centerId, d.name, d.phone, d.source, d.note);
}

/** Đăng ký học thử từ form công khai (kèm mã giới thiệu nếu có). */
export async function createPublicTrial(
  centerId: number,
  d: {
    name: string;
    phone: string;
    note: string | null;
    classId: number | null;
    desiredDate: string | null;
    referralCode: string;
  }
): Promise<void> {
  if (d.classId !== null) {
    const cls = await db
      .prepare('SELECT id FROM classes WHERE id = ? AND center_id = ?')
      .get(d.classId, centerId);
    if (!cls) throw AppError.badRequest('Lớp học không tồn tại');
  }
  let referrer: { id: number; phone: string | null } | undefined;
  if (d.referralCode) {
    referrer = (await db
      .prepare('SELECT id, phone FROM parents WHERE referral_code = ? AND center_id = ?')
      .get(d.referralCode, centerId)) as { id: number; phone: string | null } | undefined;
    // Chặn tự giới thiệu chính mình: SĐT đăng ký trùng SĐT của referrer
    if (referrer && normalizePhone(referrer.phone) === d.phone) {
      throw AppError.badRequest('Không thể dùng mã giới thiệu của chính mình');
    }
  }
  if (await recentDuplicate('trial_registrations', centerId, d.phone)) return;
  await db
    .prepare(
      "INSERT INTO trial_registrations (center_id, name, phone, class_id, desired_date, note, referral_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')"
    )
    .run(centerId, d.name, d.phone, d.classId, d.desiredDate, d.note, d.referralCode || null);
  // REF-1: referral gắn trung tâm, bỏ qua SĐT đã là học viên/phụ huynh/đã pending (modules/referrals/rewards.service.ts)
  if (referrer) await createReferral(centerId, referrer.id, d.phone);
}
