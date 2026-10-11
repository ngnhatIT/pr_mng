import { db, toISODate, type Tx } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { todayVN } from '../../shared/vnTime';

/** Định dạng tháng YYYY-MM */
export const MONTH_RE = /^\d{4}-\d{2}$/;

/** Validate tháng có thật (không chỉ đúng format). */
export function assertValidMonth(month: string): void {
  if (!MONTH_RE.test(month)) {
    throw AppError.badRequest('Tháng không hợp lệ (YYYY-MM)');
  }
  const mo = Number(month.slice(5, 7));
  if (mo < 1 || mo > 12) {
    throw AppError.badRequest('Tháng không tồn tại (01-12)');
  }
}

export interface PayrollResult {
  sessions: number;
  per_session: number;
  total: number;
  /** N5-3: đơn giá bình quân thực trả = round(total / sessions) (0 nếu không có buổi). */
  avg_rate: number;
  /** B6-2: các buổi trong tháng tính theo >1 đơn giá khác nhau (bản chốt cũ: total ≠ sessions × per_session). */
  mixed_rates: boolean;
  /**
   * B6-2: đơn giá của chính tháng đó (hiển thị) = đơn giá buổi cuối tháng; tháng không có buổi = đơn giá hiệu lực
   * ngày cuối tháng (hoặc hôm nay nếu tháng chưa hết). per_session vẫn là đơn giá HIỆN HÀNH (tương thích cũ).
   */
  month_rate: number;
}

/** Tháng hiện tại (YYYY-MM) */
export function currentMonth(): string {
  return toISODate(new Date()).slice(0, 7);
}

/**
 * Điều kiện 1 buổi (alias s) được tính lương:
 * - giáo viên = sessions.teacher_id (người dạy thực tế: gán lúc sinh buổi, cập nhật khi check-in),
 *   KHÔNG theo giáo viên hiện tại của lớp — đổi GV không làm đổi lương các tháng trước;
 * - buổi chưa hủy, đã diễn ra (date <= hôm nay giờ VN);
 * - có check-in của giáo viên HOẶC ít nhất 1 học viên có mặt/đi muộn (buổi toàn vắng không tính).
 */
const PAYABLE_SESSION = `s.status <> 'cancelled' AND substr(s.date, 1, 7) = ? AND s.date <= ?
  AND (EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id)
       OR EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present', 'late')))`;

/**
 * O-1: mỗi buổi tính theo đơn giá hiệu lực TẠI NGÀY CỦA BUỔI (salary_rate_history) — đổi đơn giá
 * không viết lại lương tháng cũ. N-1: setSalaryRule luôn ghi mốc '1970-01-01' (đơn giá trước đó, chưa có = 0)
 * nên đơn giá ĐẦU TIÊN không áp ngược. GV không có lịch sử nào (đơn giá ghi ngoài API) -> salary_rules.
 * per_session = đơn giá hiện hành; month_rate/rate_count: xem PayrollResult (B6-2).
 * Tham số: month, today, asOf (= min(ngày cuối tháng, hôm nay) — xem payrollArgs).
 */
const PAYROLL_FROM = `FROM teachers t
  LEFT JOIN sessions s ON s.teacher_id = t.id AND ${PAYABLE_SESSION}
  LEFT JOIN salary_rules sr ON sr.teacher_id = t.id
  LEFT JOIN LATERAL (SELECT COALESCE(
      (SELECT h.per_session_amount FROM salary_rate_history h
       WHERE h.teacher_id = t.id AND h.effective_from <= s.date
       ORDER BY h.effective_from DESC LIMIT 1),
      sr.per_session_amount, 0) AS rate) r ON s.id IS NOT NULL
  LEFT JOIN LATERAL (SELECT h.per_session_amount AS rate FROM salary_rate_history h
       WHERE h.teacher_id = t.id AND h.effective_from <= ?
       ORDER BY h.effective_from DESC LIMIT 1) mr ON true`;

/** Tham số theo thứ tự của PAYROLL_FROM. 'YYYY-MM-31' so chuỗi vẫn đúng mọi tháng (≥ ngày cuối, < tháng sau). */
function payrollArgs(month: string): string[] {
  const today = toISODate(new Date());
  const monthEnd = `${month}-31`;
  return [month, today, monthEnd < today ? monthEnd : today];
}

const PAYROLL_SELECT = `SELECT t.id as teacher_id, t.name as teacher_name, t.center_id, COUNT(s.id) as sessions,
  COALESCE(sr.per_session_amount, 0) as per_session, COALESCE(SUM(r.rate), 0) as total,
  COUNT(DISTINCT r.rate) as rate_count,
  COALESCE((array_agg(r.rate ORDER BY s.date DESC, s.id DESC) FILTER (WHERE s.id IS NOT NULL))[1],
    MAX(mr.rate), sr.per_session_amount, 0) as month_rate
  ${PAYROLL_FROM}`;

export interface PayrollRow extends PayrollResult {
  teacher_id: number;
  teacher_name: string;
}

/**
 * Chuẩn hóa số + avg_rate/mixed_rates/month_rate. Dòng live có rate_count (đếm đơn giá khác nhau);
 * bản chốt cũ thiếu trường mới -> giữ cách tính cũ (mixed theo per_session, month_rate = per_session).
 * Idempotent (gọi lại trên kết quả của chính nó cho cùng kết quả).
 */
function toPayrollRow(
  r: Omit<PayrollRow, 'avg_rate' | 'mixed_rates' | 'month_rate'> &
    Partial<Pick<PayrollRow, 'mixed_rates' | 'month_rate'>> & { rate_count?: number | string }
): PayrollRow {
  const sessions = Number(r.sessions) || 0;
  const per_session = Number(r.per_session) || 0;
  const total = Number(r.total) || 0;
  return {
    teacher_id: r.teacher_id,
    teacher_name: r.teacher_name,
    sessions,
    per_session,
    total,
    avg_rate: sessions ? Math.round(total / sessions) : 0,
    mixed_rates:
      r.rate_count != null ? Number(r.rate_count) > 1 : (r.mixed_rates ?? total !== sessions * per_session),
    month_rate: r.month_rate != null ? Number(r.month_rate) : per_session,
  };
}

/** Tính lương 1 giáo viên trong tháng (tổng theo đơn giá từng buổi). Tháng đã chốt -> số đã chốt. */
export async function calcPayroll(teacherId: number, month: string): Promise<PayrollResult> {
  const t = (await db.prepare('SELECT center_id FROM teachers WHERE id = ?').get(teacherId)) as
    { center_id: number | null } | undefined;
  const frozen = t?.center_id != null ? await frozenPayroll(t.center_id, month) : null;
  const row = frozen?.centers.size
    ? frozen.rows.find((r) => r.teacher_id === teacherId)
    : ((await db
        .prepare(`${PAYROLL_SELECT} WHERE t.id = ? GROUP BY t.id, t.name, t.center_id, sr.per_session_amount`)
        .get(...payrollArgs(month), teacherId)) as PayrollRow | undefined);
  if (!row) return { sessions: 0, per_session: 0, total: 0, avg_rate: 0, mixed_rates: false, month_rate: 0 };
  const { sessions, per_session, total, avg_rate, mixed_rates, month_rate } = toPayrollRow(row);
  return { sessions, per_session, total, avg_rate, mixed_rates, month_rate };
}

/**
 * Bảng lương tính từ dữ liệu hiện tại (không xét chốt tháng). Giữ center_id để ghép với bản chốt.
 * q: transaction đang giữ lock (N5-2: setPayrollClosed chụp trên cùng connection, không mượn thêm từ pool).
 */
async function livePayroll(
  centerId: number | null,
  month: string,
  q: Pick<Tx, 'prepare'> = db
): Promise<(PayrollRow & { center_id: number | null })[]> {
  const rows = (await q
    .prepare(
      `${PAYROLL_SELECT}
       ${centerId !== null ? 'WHERE t.center_id = ?' : ''}
       GROUP BY t.id, t.name, t.center_id, sr.per_session_amount
       ORDER BY t.name`
    )
    .all(...payrollArgs(month), ...(centerId !== null ? [centerId] : []))) as (PayrollRow & {
    center_id: number | null;
  })[];
  return rows.map((r) => ({ ...toPayrollRow(r), center_id: r.center_id }));
}

/**
 * N-1: số liệu đã chốt của các trung tâm đã chốt tháng `month` (centerId null = mọi trung tâm).
 * Bản chốt trước v25 chưa có snapshot -> chụp lần đầu được đọc (sau backfill mốc 1970 của v25).
 */
async function frozenPayroll(
  centerId: number | null,
  month: string
): Promise<{ centers: Set<number | null>; rows: PayrollRow[] }> {
  const closures = (await db
    .prepare(
      `SELECT center_id, snapshot FROM payroll_closures WHERE month = ? ${centerId !== null ? 'AND center_id = ?' : ''}`
    )
    .all(month, ...(centerId !== null ? [centerId] : []))) as {
    center_id: number;
    snapshot: PayrollRow[] | null;
  }[];
  const rows: PayrollRow[] = [];
  for (const c of closures) {
    let snap = c.snapshot;
    if (!snap) {
      snap = (await livePayroll(c.center_id, month)).map(toPayrollRow);
      await db
        .prepare(
          'UPDATE payroll_closures SET snapshot = ? WHERE center_id = ? AND month = ? AND snapshot IS NULL'
        )
        .run(JSON.stringify(snap), c.center_id, month);
    }
    rows.push(...snap.map(toPayrollRow));
  }
  return { centers: new Set(closures.map((c) => c.center_id)), rows };
}

/**
 * Bảng lương cả trung tâm trong 1 query duy nhất (GROUP BY teacher_id).
 * Thay thế pattern 1 + N query (N = số giáo viên).
 * N-1: trung tâm đã chốt tháng -> trả số liệu chụp lúc chốt (đổi đơn giá/điểm danh/xóa HV sau đó không đổi được).
 */
export async function calcPayrollBulk(centerId: number | null, month: string): Promise<PayrollRow[]> {
  const frozen = await frozenPayroll(centerId, month);
  const live = await livePayroll(centerId, month);
  if (!frozen.centers.size) return live.map(toPayrollRow);
  return [...live.filter((r) => !frozen.centers.has(r.center_id)), ...frozen.rows]
    .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name))
    .map(toPayrollRow);
}

/** Ngày đầu tháng trước (YYYY-MM-01) của một ngày YYYY-MM-DD. */
export function firstDayOfPrevMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/**
 * J-A8: tháng lương đã chốt -> 409. Dùng cho đổi đơn giá lùi ngày, lưu điểm danh, hủy buổi.
 * date: 'YYYY-MM-DD' (hoặc 'YYYY-MM'); chặn khi tháng đó HOẶC tháng sau đã chốt (tháng sau chốt
 * nghĩa là mọi tháng trước đã trả lương). centerId null (dữ liệu cũ không gắn trung tâm) -> bỏ qua.
 * Gọi TRONG transaction ghi: giữ advisory lock SHARED của trung tâm tới commit — setPayrollClosed giữ
 * EXCLUSIVE khi chụp snapshot, nên lần ghi đang dở hoặc đã vào snapshot, hoặc thấy tháng đã chốt (409).
 */
export async function assertPayrollMonthOpen(tx: Tx, centerId: number | null, date: string): Promise<void> {
  if (centerId === null) return;
  // Câu riêng: snapshot của câu kiểm tra phải lấy SAU khi có lock (thấy closure vừa commit)
  await tx.prepare(`SELECT pg_advisory_xact_lock_shared(hashtext('payroll-close'), ?)`).get(centerId);
  const closed = (await tx
    .prepare('SELECT month FROM payroll_closures WHERE center_id = ? AND month >= ? ORDER BY month LIMIT 1')
    .get(centerId, date.slice(0, 7))) as { month: string } | undefined;
  if (closed) {
    throw AppError.conflict(
      `Bảng lương tháng ${closed.month} đã chốt — không sửa được dữ liệu ảnh hưởng lương từ ${date.slice(0, 7)}`,
      'PAYROLL_CLOSED'
    );
  }
}

/** J-A8: chốt / mở lại tháng lương (payroll.manage). Chỉ chốt được tháng đã kết thúc. */
export async function setPayrollClosed(
  centerId: number,
  month: string,
  closed: boolean,
  actor?: AuditActor
): Promise<void> {
  assertValidMonth(month);
  if (closed && month >= todayVN().slice(0, 7)) {
    throw AppError.badRequest('Chỉ chốt được tháng đã kết thúc');
  }
  // N-1: chụp bảng lương lúc chốt — tháng đã chốt luôn trả đúng số này (xem frozenPayroll).
  // Lock EXCLUSIVE: chờ các lần ghi lương đang dở commit rồi mới chụp; lần ghi sau thấy tháng đã chốt.
  const r = closed
    ? await db.transaction(async (tx) => {
        await tx.prepare(`SELECT pg_advisory_xact_lock(hashtext('payroll-close'), ?)`).get(centerId);
        const snapshot = JSON.stringify((await livePayroll(centerId, month, tx)).map(toPayrollRow));
        return tx
          .prepare(
            'INSERT INTO payroll_closures (center_id, month, closed_by, snapshot) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
          )
          .run(centerId, month, actor?.id ?? null, snapshot);
      })
    : await db.prepare('DELETE FROM payroll_closures WHERE center_id = ? AND month = ?').run(centerId, month);
  if (r.changes === 0) return; // idempotent
  await audit({
    centerId,
    action: 'update',
    entity: 'payroll_closures',
    entityId: null,
    summary: `${closed ? 'Chốt' : 'Mở lại'} bảng lương tháng ${month}`,
    meta: { month, closed },
    actor,
  });
}

/** Các tháng đã chốt của trung tâm (mới nhất trước). */
export async function listPayrollClosures(centerId: number | null): Promise<unknown[]> {
  return db
    .prepare(
      `SELECT center_id, month, closed_by, closed_at FROM payroll_closures
       ${centerId !== null ? 'WHERE center_id = ?' : ''} ORDER BY month DESC LIMIT 120`
    )
    .all(...(centerId !== null ? [centerId] : []));
}

/**
 * Đặt đơn giá lương theo buổi (PUT /payroll/rules). Ghi lịch sử theo ngày hiệu lực
 * (mặc định hôm nay giờ VN; chỉ lùi được tới đầu tháng trước để sửa sai) và cập nhật
 * salary_rules = đơn giá đang hiệu lực hôm nay. Ném AppError (404 GV khác trung tâm, 400 dữ liệu sai).
 */
export async function setSalaryRule(
  centerId: number | null,
  input: { teacher_id: number; per_session_amount: number; effective_from?: string | null },
  actor?: AuditActor
): Promise<void> {
  const teacher = (await db
    .prepare('SELECT id, center_id FROM teachers WHERE id = ?')
    .get(input.teacher_id)) as { id: number; center_id: number | null } | undefined;
  if (!teacher || (centerId !== null && teacher.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy giáo viên');
  }
  const amount = Number(input.per_session_amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) {
    throw AppError.badRequest('Số tiền mỗi buổi phải là số nguyên từ 0 đến 100,000,000');
  }
  const today = todayVN();
  const effectiveFrom = input.effective_from || today;
  if (effectiveFrom > today || effectiveFrom < firstDayOfPrevMonth(today)) {
    throw AppError.badRequest('Ngày hiệu lực chỉ được từ đầu tháng trước đến hôm nay');
  }
  const old = await db.transaction(async (tx) => {
    await assertPayrollMonthOpen(tx, teacher.center_id, effectiveFrom);
    const prev = (await tx
      .prepare('SELECT per_session_amount FROM salary_rules WHERE teacher_id = ? FOR UPDATE')
      .get(teacher.id)) as { per_session_amount: number } | undefined;
    // Chưa có lịch sử -> mốc '1970-01-01' = đơn giá trước đó (GV có giá từ trước v23) hoặc 0 (N-1: đơn giá
    // đầu tiên KHÔNG áp ngược cho các tháng cũ — kể cả tháng đã chốt)
    await tx
      .prepare(
        `INSERT INTO salary_rate_history (teacher_id, effective_from, per_session_amount)
         SELECT ?, '1970-01-01', ? WHERE NOT EXISTS (SELECT 1 FROM salary_rate_history WHERE teacher_id = ?)`
      )
      .run(teacher.id, prev?.per_session_amount ?? 0, teacher.id);
    await tx
      .prepare(
        `INSERT INTO salary_rate_history (teacher_id, effective_from, per_session_amount, changed_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (teacher_id, effective_from)
         DO UPDATE SET per_session_amount = excluded.per_session_amount, changed_by = excluded.changed_by`
      )
      .run(teacher.id, effectiveFrom, amount, actor?.id ?? null);
    // Đơn giá hiện hành = bản lịch sử mới nhất đã hiệu lực (sửa lùi ngày không đè giá mới hơn)
    const current = (await tx
      .prepare(
        `SELECT per_session_amount FROM salary_rate_history
         WHERE teacher_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`
      )
      .get(teacher.id, today)) as { per_session_amount: number };
    await tx
      .prepare(
        `INSERT INTO salary_rules (teacher_id, per_session_amount, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(teacher_id) DO UPDATE SET per_session_amount = excluded.per_session_amount, updated_at = datetime('now')`
      )
      .run(teacher.id, current.per_session_amount);
    return prev;
  });
  // Audit: thay đổi định mức lương ảnh hưởng trực tiếp tiền lương
  await audit({
    centerId: teacher.center_id,
    action: old ? 'update' : 'create',
    entity: 'salary_rules',
    entityId: teacher.id,
    summary: `Đổi định mức lương GV#${teacher.id}: ${old?.per_session_amount ?? 0} → ${amount}đ/buổi từ ${effectiveFrom}`,
    meta: {
      teacher_id: teacher.id,
      old_amount: old?.per_session_amount ?? null,
      new_amount: amount,
      effective_from: effectiveFrom,
    },
    actor,
  });
}
