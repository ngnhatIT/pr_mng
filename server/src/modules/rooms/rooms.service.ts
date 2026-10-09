import { db } from '../../db';
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
