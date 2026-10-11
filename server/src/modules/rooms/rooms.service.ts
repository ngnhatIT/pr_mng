import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export interface RoomRow {
  id: number;
  name: string;
  center_id: number | null;
  class_count?: number;
  [key: string]: unknown;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách phòng học kèm số lớp đang dùng (có phân trang). */
export async function listRooms(
  centerId: number | null,
  pageOpts: PageOptions = {}
): Promise<Paginated<RoomRow>> {
  const where = centerId !== null ? 'WHERE r.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [centerId] : [];
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM rooms r ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM classes c WHERE c.room_id = r.id AND c.status = 'active') as class_count
       FROM rooms r ${where}
       ORDER BY r.id LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as RoomRow[];
  return paginate(rows, total, page, limit);
}

async function getScopedRoom(centerId: number | null, id: number) {
  // superadmin (centerId null) được thao tác phòng mọi trung tâm
  const row = (await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)) as
    { id: number; center_id: number | null; name: string } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId))
    throw AppError.notFound('Không tìm thấy phòng học');
  return row;
}

/** Thêm phòng học (chống trùng tên trong trung tâm). */
export async function createRoom(centerId: number, name: string, capacity: number, actor: AuditActor) {
  const dup = await db
    .prepare('SELECT id FROM rooms WHERE center_id = ? AND LOWER(name) = LOWER(?)')
    .get(centerId, name);
  if (dup) throw AppError.conflict('Tên phòng đã tồn tại trong trung tâm', 'DUPLICATE');
  const r = await db
    .prepare('INSERT INTO rooms (center_id, name, capacity) VALUES (?, ?, ?)')
    .run(centerId, name, capacity);
  const roomId = Number(r.lastInsertRowid);
  await audit({
    centerId,
    action: 'create',
    entity: 'rooms',
    entityId: roomId,
    summary: `Tạo phòng "${name}"`,
    actor,
  });
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
}

/** Sửa phòng học (chống trùng tên, loại trừ chính phòng đang sửa). */
export async function updateRoom(
  centerId: number | null,
  id: number,
  name: string,
  capacity: number,
  actor: AuditActor
) {
  const room = await getScopedRoom(centerId, id);
  const dup = await db
    .prepare('SELECT id FROM rooms WHERE center_id = ? AND LOWER(name) = LOWER(?) AND id != ?')
    .get(room.center_id, name, id);
  if (dup) throw AppError.conflict('Tên phòng đã tồn tại trong trung tâm', 'DUPLICATE');
  await db.prepare('UPDATE rooms SET name = ?, capacity = ? WHERE id = ?').run(name, capacity, id);
  await audit({
    centerId: room.center_id,
    actor,
    action: 'update',
    entity: 'rooms',
    entityId: id,
    summary: `Cập nhật phòng ${name}`,
    meta: { old_name: room.name, new_name: name, capacity },
  });
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
}

/** Xóa phòng học (gỡ phòng khỏi các lớp đang dùng). */
export async function deleteRoom(centerId: number | null, id: number, actor: AuditActor): Promise<void> {
  const room = await getScopedRoom(centerId, id);
  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE classes SET room_id = NULL WHERE room_id = ?').run(id);
    await tx.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  });
  await audit({
    centerId: room.center_id,
    actor,
    action: 'delete',
    entity: 'rooms',
    entityId: id,
    summary: `Xóa phòng "${room.name}" (gỡ phòng khỏi các lớp đang dùng)`,
  });
}
