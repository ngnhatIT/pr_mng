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
export function listRubrics(centerId: number | null): Rubric[] {
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('(center_id = ? OR center_id IS NULL)');
    params.push(centerId);
  }
  const rows = db
    .prepare(`SELECT * FROM rubrics WHERE ${conds.join(' AND ')} ORDER BY id DESC`)
    .all(...params) as { id: number; name: string }[];
  return rows.map((r) => getRubric(r.id)!);
}

/** Chi tiết rubric kèm tiêu chí (scope center để chống cross-tenant). */
export function getRubric(id: number, centerId?: number | null): Rubric | null {
  const r = db.prepare('SELECT * FROM rubrics WHERE id = ?').get(id) as
    | { id: number; name: string; center_id: number | null }
    | undefined;
  if (!r) return null;
  if (centerId !== undefined && centerId !== null && r.center_id !== null && r.center_id !== centerId) {
    return null;
  }
  const criteria = db
    .prepare('SELECT id, name, max_score FROM rubric_criteria WHERE rubric_id = ? ORDER BY position, id')
    .all(id) as RubricCriterion[];
  return {
    id: r.id,
    name: r.name,
    criteria,
    total_score: criteria.reduce((s, c) => s + c.max_score, 0),
  };
}

/** Tạo rubric mới với các tiêu chí. Validate hết trước khi insert (tránh rubric mồ côi). */
export function createRubric(
  centerId: number | null,
  createdBy: number,
  data: { name: string; criteria: { name: string; max_score: number }[] }
): Rubric {
  if (!data.name.trim()) throw AppError.badRequest('Vui lòng nhập tên rubric');
  if (!data.criteria.length) throw AppError.badRequest('Rubric cần ít nhất 1 tiêu chí');
  // Validate toàn bộ trước
  data.criteria.forEach((c, i) => {
    if (!c.name.trim()) throw AppError.badRequest(`Tiêu chí ${i + 1} chưa có tên`);
  });
  const tx = db.transaction(() => {
    const ins = db
      .prepare('INSERT INTO rubrics (center_id, name, created_by) VALUES (?, ?, ?)')
      .run(centerId, data.name.trim(), createdBy);
    const rid = Number(ins.lastInsertRowid);
    const stmt = db.prepare(
      'INSERT INTO rubric_criteria (rubric_id, name, max_score, position) VALUES (?, ?, ?, ?)'
    );
    data.criteria.forEach((c, i) => {
      stmt.run(rid, c.name.trim(), Math.max(0, Number(c.max_score) || 0), i);
    });
    return rid;
  });
  const rid = tx();
  return getRubric(rid)!;
}

/** Xóa rubric (chỉ khi chưa gắn vào bài tập nào, và thuộc center). */
export function deleteRubric(id: number, centerId: number | null): void {
  const r = db.prepare('SELECT center_id FROM rubrics WHERE id = ?').get(id) as
    | { center_id: number | null }
    | undefined;
  if (!r) return;
  if (centerId !== null && r.center_id !== null && r.center_id !== centerId) {
    throw AppError.notFound('Không tìm thấy rubric');
  }
  const used = db.prepare('SELECT 1 FROM homework WHERE rubric_id = ? LIMIT 1').get(id);
  if (used) throw AppError.badRequest('Rubric đang được dùng, không thể xóa');
  db.prepare('DELETE FROM rubric_criteria WHERE rubric_id = ?').run(id);
  db.prepare('DELETE FROM rubrics WHERE id = ?').run(id);
}
