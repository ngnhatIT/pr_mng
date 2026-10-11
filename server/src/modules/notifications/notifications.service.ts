import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { pushInApp } from '../../services/notify';
import { audit, type AuditActor } from '../../shared/audit';

export type Recipient = { type: 'user' | 'parent'; id: number };

export interface NotificationRow {
  id: number;
  kind: string;
  params: Record<string, unknown>;
  title: string | null;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Thông báo của chính người gọi (mới nhất trước); unreadOnly lọc chưa đọc. */
export async function listMine(
  me: Recipient,
  opts: { unreadOnly?: boolean } & PageOptions = {}
): Promise<Paginated<NotificationRow> & { unread: number }> {
  const { page, limit, offset } = parsePagination(opts);
  const where = `recipient_type = ? AND recipient_id = ?${opts.unreadOnly ? ' AND read_at IS NULL' : ''}`;
  const [total, rows, unread] = await Promise.all([
    db.prepare(`SELECT COUNT(*)::int AS c FROM notifications WHERE ${where}`).get(me.type, me.id),
    db
      .prepare(
        `SELECT id, kind, params, title, body, link, read_at, created_at FROM notifications
         WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(me.type, me.id, limit, offset),
    unreadCount(me),
  ]);
  return { ...paginate(rows as NotificationRow[], (total as { c: number }).c, page, limit), unread };
}

export async function unreadCount(me: Recipient): Promise<number> {
  const r = (await db
    .prepare(
      'SELECT COUNT(*)::int AS c FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL'
    )
    .get(me.type, me.id)) as { c: number };
  return r.c;
}

/** Đánh dấu đã đọc 1 thông báo của mình (của người khác -> 404, không lộ tồn tại). */
export async function markRead(me: Recipient, id: number): Promise<void> {
  const r = await db
    .prepare(
      `UPDATE notifications SET read_at = COALESCE(read_at, to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
       WHERE id = ? AND recipient_type = ? AND recipient_id = ?`
    )
    .run(id, me.type, me.id);
  if (!r.changes) throw AppError.notFound('Không tìm thấy thông báo', 'NOTIFICATION_NOT_FOUND');
}

export async function markAllRead(me: Recipient): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE notifications SET read_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
       WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`
    )
    .run(me.type, me.id);
  return r.changes ?? 0;
}

/* ------------------------------ Thông báo chung ------------------------------ */

/**
 * Gửi thông báo chung tới phụ huynh: cả trung tâm (classId null) hoặc phụ huynh của học viên đang học 1 lớp.
 * Lưu lịch sử vào announcements + đẩy chuông cho từng phụ huynh.
 */
export async function createAnnouncement(
  centerId: number,
  input: { title: string; body: string; class_id?: number | null },
  actor?: AuditActor
): Promise<{ id: number; recipient_count: number }> {
  const classId = input.class_id ?? null;
  if (classId !== null) {
    const cls = await db
      .prepare('SELECT 1 FROM classes WHERE id = ? AND center_id = ?')
      .get(classId, centerId);
    if (!cls) throw AppError.badRequest('Lớp học không hợp lệ', 'INVALID_CLASS');
  }
  const parents = (await db
    .prepare(
      classId === null
        ? 'SELECT id FROM parents WHERE center_id = ? AND is_active'
        : `SELECT DISTINCT ps.parent_id AS id FROM enrollments e
           JOIN parent_students ps ON ps.student_id = e.student_id
           JOIN parents p ON p.id = ps.parent_id AND p.is_active
           WHERE e.class_id = ? AND e.status = 'active'`
    )
    .all(classId === null ? centerId : classId)) as { id: number }[];
  const row = (await db
    .prepare(
      `INSERT INTO announcements (center_id, class_id, title, body, recipient_count, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(centerId, classId, input.title, input.body, parents.length, actor?.id ?? null)) as { id: number };
  await pushInApp(
    centerId,
    'parent',
    parents.map((p) => p.id),
    { kind: 'announcement', title: input.title, body: input.body, link: '/parent/notifications' }
  );
  await audit({
    centerId,
    actor,
    action: 'create',
    entity: 'announcements',
    entityId: row.id,
    summary: `Gửi thông báo "${input.title}" tới ${parents.length} phụ huynh`,
  });
  return { id: row.id, recipient_count: parents.length };
}

export async function listAnnouncements(centerId: number | null, pageOpts: PageOptions = {}) {
  const { page, limit, offset } = parsePagination(pageOpts);
  const where = centerId === null ? '' : 'WHERE a.center_id = ?';
  const p = centerId === null ? [] : [centerId];
  const total = (await db.prepare(`SELECT COUNT(*)::int AS c FROM announcements a ${where}`).get(...p)) as {
    c: number;
  };
  const rows = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.class_id, c.name AS class_name, a.recipient_count, a.created_at,
         u.name AS created_by_name
       FROM announcements a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...p, limit, offset);
  return paginate(rows, total.c, page, limit);
}
