import { db } from '../db';
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
      error: String(err),
    });
  }
}

/** Gửi (ghi log) thông báo tới mọi phụ huynh của học viên */
export async function notifyParents(
  studentId: number,
  kind: NoticeKind,
  message: string,
  invoiceId?: number | null
): Promise<void> {
  const contacts = await getParentContacts(studentId);
  for (const c of contacts) {
    await logParentNotice({ studentId, invoiceId: invoiceId ?? null, phone: c.phone, kind, message });
  }
}
