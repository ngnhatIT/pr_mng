import { db } from '../../db';
import { AppError } from '../../shared/errors';

/* ---------------------------------- Types ---------------------------------- */

export interface RubricCriterion {
  id: number;
  name: string;
  max_score: number;
}

export interface Rubric {
  id: number;
  name: string;
  criteria: RubricCriterion[];
  total_score: number;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách rubric của trung tâm. */
export async function listRubrics(centerId: number | null): Promise<Rubric[]> {
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('(center_id = ? OR center_id IS NULL)');
    params.push(centerId);
  }
  const rows = (await db
    .prepare(`SELECT * FROM rubrics WHERE ${conds.join(' AND ')} ORDER BY id DESC`)
    .all(...params)) as { id: number; name: string }[];
  return (await Promise.all(rows.map((r) => getRubric(r.id)))).filter((r): r is Rubric => r !== null);
}

/** Chi tiết rubric kèm tiêu chí (scope center để chống cross-tenant). */
export async function getRubric(id: number, centerId?: number | null): Promise<Rubric | null> {
  const r = (await db.prepare('SELECT * FROM rubrics WHERE id = ?').get(id)) as
    { id: number; name: string; center_id: number | null } | undefined;
  if (!r) return null;
  if (centerId !== undefined && centerId !== null && r.center_id !== null && r.center_id !== centerId) {
    return null;
  }
  const criteria = (await db
    .prepare('SELECT id, name, max_score FROM rubric_criteria WHERE rubric_id = ? ORDER BY position, id')
    .all(id)) as RubricCriterion[];
  return {
    id: r.id,
    name: r.name,
    criteria,
    total_score: criteria.reduce((s, c) => s + c.max_score, 0),
  };
}

/** Tạo rubric mới với các tiêu chí. Validate hết trước khi insert (tránh rubric mồ côi). */
export async function createRubric(
  centerId: number | null,
  createdBy: number,
  data: { name: string; criteria: { name: string; max_score: number }[] }
): Promise<Rubric> {
  // P1-3: thiếu field bắt buộc → 400, không để trim() trên undefined gây 500
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw AppError.badRequest('Vui lòng nhập tên rubric');
  if (name.length > 200) throw AppError.badRequest('Tên rubric tối đa 200 ký tự');
  const criteria = Array.isArray(data.criteria) ? data.criteria : [];
  if (!criteria.length) throw AppError.badRequest('Rubric cần ít nhất 1 tiêu chí');
  if (criteria.length > 50) throw AppError.badRequest('Rubric tối đa 50 tiêu chí');
  // Validate toàn bộ trước. HW-21: điểm tiêu chí sai → 400, không ép ngầm về 0
  const clean = criteria.map((c, i) => {
    if (typeof c?.name !== 'string' || !c.name.trim())
      throw AppError.badRequest(`Tiêu chí ${i + 1} chưa có tên`);
    if (c.name.trim().length > 200) throw AppError.badRequest(`Tên tiêu chí ${i + 1} tối đa 200 ký tự`);
    const max = Number(c.max_score);
    if (!Number.isFinite(max) || max <= 0 || max > 1000)
      throw AppError.badRequest(`Điểm tối đa tiêu chí ${i + 1} phải từ trên 0 đến 1000`);
    return { name: c.name.trim(), max_score: max };
  });
  const rid = await db.transaction(async (tx) => {
    const ins = await tx
      .prepare('INSERT INTO rubrics (center_id, name, created_by) VALUES (?, ?, ?)')
      .run(centerId, name, createdBy);
    const rid = Number(ins.lastInsertRowid);
    const stmt = await tx.prepare(
      'INSERT INTO rubric_criteria (rubric_id, name, max_score, position) VALUES (?, ?, ?, ?)'
    );
    for (const [i, c] of clean.entries()) await stmt.run(rid, c.name, c.max_score, i);
    return rid;
  });
  return (await getRubric(rid))!;
}

/** Xóa rubric (chỉ khi chưa gắn vào bài tập nào, và thuộc center). */
export async function deleteRubric(id: number, centerId: number | null): Promise<void> {
  const r = (await db.prepare('SELECT center_id FROM rubrics WHERE id = ?').get(id)) as
    { center_id: number | null } | undefined;
  if (!r) return;
  // HW-10: rubric global (dùng chung mọi trung tâm) chỉ superadmin được xóa — như P1-10 của bank
  if (r.center_id === null && centerId !== null) throw AppError.notFound('Không tìm thấy rubric');
  if (centerId !== null && r.center_id !== null && r.center_id !== centerId) {
    throw AppError.notFound('Không tìm thấy rubric');
  }
  const used = await db.prepare('SELECT 1 FROM homework WHERE rubric_id = ? LIMIT 1').get(id);
  if (used) throw AppError.badRequest('Rubric đang được dùng, không thể xóa');
  await db.prepare('DELETE FROM rubric_criteria WHERE rubric_id = ?').run(id);
  await db.prepare('DELETE FROM rubrics WHERE id = ?').run(id);
}
