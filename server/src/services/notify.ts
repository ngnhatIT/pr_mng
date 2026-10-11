import { db } from '../db';
import { formatError } from '../shared/errorFormat';
import { logger } from '../shared/logger';
import { normalizePhone } from './zalo';

const log = logger.scope('notify');

export type NoticeKind = 'absence' | 'leave_result' | 'payment_confirmed' | 'grade' | 'homework' | 'general';

export interface ParentContact {
  parent_id: number;
  phone: string | null;
  name: string;
}

/** Lấy danh sách phụ huynh đã liên kết với học viên (kèm SĐT chuẩn hóa) */
export async function getParentContacts(studentId: number): Promise<ParentContact[]> {
  const rows = (await db
    .prepare(
      `SELECT p.id as parent_id, p.phone, p.name
       FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
       WHERE ps.student_id = ?`
    )
    .all(studentId)) as ParentContact[];
  return rows;
}

/**
 * Ghi thông báo cho phụ huynh vào bảng reminders (tận dụng cơ chế log + demo hiện có).
 * Các loại như absence/leave_result/payment_confirmed chưa có template ZNS riêng nên
 * ghi ở trạng thái 'demo' — trung tâm xem được trong Lịch sử nhắc; khi có template
 * ZNS cho từng loại thì mở rộng gửi thật tại đây.
 */
export async function logParentNotice(opts: {
  studentId?: number | null;
  invoiceId?: number | null;
  phone?: string | null;
  kind: NoticeKind;
  message: string;
}): Promise<void> {
  const phone = normalizePhone(opts.phone ?? null);
  try {
    await db
      .prepare(
        'INSERT INTO reminders (invoice_id, student_id, phone, kind, status, message, response) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        opts.invoiceId ?? null,
        opts.studentId ?? null,
        phone || opts.phone || null,
        opts.kind,
        'demo',
        opts.message,
        null
      );
  } catch (err) {
    // KHÔNG nuốt lỗi im lặng: ghi log đầy đủ để phát hiện CHECK/constraint hỏng
    log.error('logParentNotice failed', {
      kind: opts.kind,
      studentId: opts.studentId ?? null,
      invoiceId: opts.invoiceId ?? null,
      error: formatError(err),
    });
  }
}

/** Nội dung thông báo trong app: kind + params để client dịch theo ngôn ngữ; body là câu dự phòng (tiếng Việt). */
export interface InAppNotice {
  kind: string;
  params?: Record<string, unknown>;
  title?: string | null;
  body?: string | null;
  link?: string | null;
}

/**
 * Ghi thông báo trong app (chuông) cho danh sách người nhận. Lỗi chỉ log, không làm hỏng nghiệp vụ chính
 * (thông báo là side-effect sau khi đã commit).
 */
export async function pushInApp(
  centerId: number | null,
  recipientType: 'user' | 'parent',
  recipientIds: number[],
  n: InAppNotice
): Promise<number> {
  const ids = [...new Set(recipientIds)];
  if (!ids.length) return 0;
  try {
    const r = await db
      .prepare(
        `INSERT INTO notifications (center_id, recipient_type, recipient_id, kind, params, title, body, link)
         SELECT ?, ?, rid, ?, ?::jsonb, ?, ?, ? FROM unnest(?::int[]) AS rid`
      )
      .run(
        centerId,
        recipientType,
        n.kind,
        JSON.stringify(n.params ?? {}),
        n.title ?? null,
        n.body ?? null,
        n.link ?? null,
        ids
      );
    return r.changes ?? ids.length;
  } catch (err) {
    log.error('pushInApp failed', { kind: n.kind, recipientType, error: formatError(err) });
    return 0;
  }
}

/**
 * Nhân sự của trung tâm có permission (scope center/all) qua role chính hoặc custom role, tài khoản còn hoạt động.
 * Superadmin không nhận (không thuộc trung tâm).
 */
export async function staffWithPermission(centerId: number, permission: string): Promise<number[]> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT u.id FROM users u
       JOIN roles r ON (r.code = u.role AND r.center_id IS NULL)
         OR r.id IN (SELECT role_id FROM user_roles ur WHERE ur.user_id = u.id)
       JOIN role_permissions rp ON rp.role_id = r.id AND rp.scope IN ('center', 'all')
       JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
       WHERE u.center_id = ? AND u.is_active`
    )
    .all(permission, centerId)) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Báo cho nhân sự có quyền xử lý việc này (vd leaves.manage khi có đơn nghỉ mới). */
export async function notifyStaff(
  centerId: number | null,
  permission: string,
  n: InAppNotice
): Promise<void> {
  if (centerId === null) return;
  try {
    await pushInApp(centerId, 'user', await staffWithPermission(centerId, permission), n);
  } catch (err) {
    log.error('notifyStaff failed', { kind: n.kind, permission, error: formatError(err) });
  }
}

/** Gửi thông báo tới mọi phụ huynh của học viên: log nhắc (Zalo/demo) + chuông trong app. */
export async function notifyParents(
  studentId: number,
  kind: NoticeKind,
  message: string,
  invoiceId?: number | null,
  /** kind riêng cho chuông (vd payment_rejected) + params dịch được */
  inApp?: Partial<InAppNotice>
): Promise<void> {
  const contacts = await getParentContacts(studentId);
  for (const c of contacts) {
    await logParentNotice({ studentId, invoiceId: invoiceId ?? null, phone: c.phone, kind, message });
  }
  const center = (await db.prepare('SELECT center_id FROM students WHERE id = ?').get(studentId)) as
    { center_id: number | null } | undefined;
  await pushInApp(
    center?.center_id ?? null,
    'parent',
    contacts.map((c) => c.parent_id),
    { kind, body: message, link: `/parent/children/${studentId}`, ...inApp }
  );
}
