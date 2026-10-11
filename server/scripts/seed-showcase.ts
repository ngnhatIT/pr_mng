/* eslint-disable no-console -- script chạy tay: in tiến độ cho người chạy */
/**
 * Bổ sung dữ liệu trình diễn vào trung tâm demo (subdomain 'demo') — KHÔNG xóa gì.
 *
 * Chạy (trong thư mục server/, sau khi DB đã có seed demo gốc):
 *   npx tsx scripts/seed-showcase.ts
 *
 * - Chỉ chạy một lần: thấy giáo viên đầu tiên của bộ dữ liệu (theo email) thì dừng.
 * - Ghi thẳng DB trong MỘT transaction (lỗi giữa chừng -> không để lại dữ liệu dở). Không đi qua HTTP vì
 *   API giới hạn 300 lần ghi / 15 phút / tài khoản, bộ này cần ~4.000 dòng.
 * - Ngày tháng tính tương đối theo hôm nay; ngẫu nhiên có seed cố định nên chạy trên DB giống nhau ra cùng kết quả.
 * - Trạng thái hóa đơn tính đúng công thức của recalcInvoiceStatus; chạy xong tự đối soát tài chính.
 */
import bcrypt from 'bcryptjs';
import {
  db,
  closePool,
  toISODate,
  addDays,
  parseISODate,
  generateSessionsForClass,
} from '../src/db/index.js';
import type { Tx } from '../src/db/index.js';
import { checkFinancialConsistency } from '../src/db/consistency.js';
import * as D from './showcase-data.js';

/* ------------------------------ tiện ích ------------------------------ */
let seed = 20261011;
/** mulberry32: đủ đều cho dữ liệu mẫu, lặp lại được. */
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const pad = (n: number) => String(n).padStart(2, '0');

const TODAY = toISODate(new Date());
const T0 = parseISODate(TODAY);
const day = (offset: number) => toISODate(addDays(T0, offset));
const shift = (iso: string, n: number) => toISODate(addDays(parseISODate(iso), n));
const NOW_TS = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // 'YYYY-MM-DD HH:MM:SS'
/** Mốc giờ của ngày `iso`; không bao giờ vượt hiện tại (hóa đơn/bài nộp "hôm nay" lúc 15h khi mới 11h trông như dữ liệu giả). */
const at = (iso: string, h = int(8, 20), m = int(0, 59)) => {
  const ts = `${iso} ${pad(h)}:${pad(m)}:${pad(int(0, 59))}`;
  if (ts <= NOW_TS) return ts;
  const back = new Date(Date.now() - int(5, 180) * 60000).toLocaleString('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return back;
};
const minDate = (a: string, b: string) => (a < b ? a : b);
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

const PHONE_PREFIX = ['090', '093', '097', '098', '091', '094', '096', '088', '070', '079', '083', '086'];
const usedPhones = new Set<string>();
function phone(): string {
  for (;;) {
    const p = pick(PHONE_PREFIX) + String(int(0, 9999999)).padStart(7, '0');
    if (!usedPhones.has(p)) {
      usedPhones.add(p);
      return p;
    }
  }
}

const METHODS: [string, number][] = [
  ['Chuyển khoản', 0.5],
  ['Tiền mặt', 0.35],
  ['Quẹt thẻ', 0.1],
  ['Ví điện tử', 0.05],
];
function method(): string {
  let r = rand();
  for (const [m, w] of METHODS) if ((r -= w) <= 0) return m;
  return 'Tiền mặt';
}

const TOPICS: Record<string, string[]> = {
  IELTS: [
    'Placement review & mục tiêu khóa',
    'Listening Section 1 – form completion',
    'Reading: True / False / Not Given',
    'Writing Task 1: biểu đồ cột',
    'Speaking Part 1: chủ đề quen thuộc',
    'Từ vựng chủ đề Education',
    'Listening Section 2 – map labelling',
    'Writing Task 2: dạng Discuss both views',
    'Mini test giữa khóa',
    'Chữa bài mini test',
    'Speaking Part 2: cue card',
    'Reading: Matching headings',
  ],
  TOEIC: [
    'Part 1 – mô tả tranh',
    'Part 2 – hỏi đáp',
    'Part 5 – từ loại',
    'Part 5 – thì động từ',
    'Part 6 – điền đoạn văn',
    'Part 7 – đọc email',
    'Từ vựng chủ đề Office',
    'Mini test Listening',
    'Chữa mini test',
    'Part 3 – hội thoại',
  ],
  default: [
    'Làm quen & mục tiêu khóa học',
    'Từ vựng chủ đề gia đình',
    'Ngữ pháp trọng tâm bài 2',
    'Luyện nghe hội thoại ngắn',
    'Luyện nói theo cặp',
    'Đọc hiểu đoạn văn ngắn',
    'Luyện viết câu',
    'Kiểm tra 15 phút',
    'Chữa bài & phản hồi',
    'Ôn tập giữa khóa',
    'Từ vựng chủ đề mua sắm',
    'Trò chơi ôn từ vựng',
  ],
};

interface AuditRow {
  action: string;
  entity: string;
  entityId: number | null;
  summary: string;
  at: string;
}

/* ------------------------------ seed ------------------------------ */
async function run(tx: Tx): Promise<Record<string, number>> {
  const count: Record<string, number> = {};
  const bump = (k: string, n = 1) => (count[k] = (count[k] ?? 0) + n);
  const audits: AuditRow[] = [];
  const ins = async (sql: string, ...args: unknown[]) =>
    Number((await tx.prepare(sql).run(...args)).lastInsertRowid);

  const center = (await tx.prepare("SELECT id FROM centers WHERE subdomain = 'demo'").get()) as
    { id: number } | undefined;
  if (!center) throw new Error('Chưa có trung tâm demo: chạy server với SEED_DEMO=true trước.');
  const C = center.id;
  const admin = (await tx
    .prepare("SELECT id, name FROM users WHERE center_id = ? AND role = 'admin' ORDER BY id LIMIT 1")
    .get(C)) as { id: number; name: string } | undefined;
  if (!admin) throw new Error('Không tìm thấy tài khoản admin của trung tâm demo.');
  // Trigger lịch sử hóa đơn/thanh toán ghi người thao tác là admin
  await tx.prepare("SELECT set_config('app.user_id', ?, true)").get(`${admin.id}:admin`);

  // Tên mặc định "Trung tâm Demo" hiện trên landing/hóa đơn -> tên trình diễn (chỉ đổi nếu còn tên mặc định)
  await tx
    .prepare("UPDATE centers SET name = ? WHERE id = ? AND name = 'Trung tâm Demo'")
    .run(D.CENTER_NAME, C);

  /* Phòng */
  const roomId = new Map<string, number>();
  for (const r of D.NEW_ROOMS) {
    await tx
      .prepare(
        'INSERT INTO rooms (center_id, name, capacity) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE center_id = ? AND name = ?)'
      )
      .run(C, r.name, r.capacity, C, r.name);
  }
  for (const r of (await tx.prepare('SELECT id, name FROM rooms WHERE center_id = ?').all(C)) as {
    id: number;
    name: string;
  }[])
    roomId.set(r.name, r.id);
  for (const [cls, room] of Object.entries(D.EXISTING_CLASS_ROOMS))
    await tx
      .prepare('UPDATE classes SET room_id = ? WHERE center_id = ? AND name = ? AND room_id IS NULL')
      .run(roomId.get(room), C, cls);

  /* Giáo viên + đơn giá */
  const teacherId = new Map<string, number>();
  for (const t of D.TEACHERS) {
    const id = await ins(
      'INSERT INTO teachers (name, phone, email, subject, center_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      t.name,
      t.phone,
      t.email,
      t.subject,
      C,
      at(day(-130), 10)
    );
    usedPhones.add(t.phone);
    bump('giáo viên');
    audits.push({
      action: 'create',
      entity: 'teachers',
      entityId: id,
      summary: `Thêm giáo viên ${t.name}`,
      at: at(day(-130), 10),
    });
  }
  for (const r of (await tx.prepare('SELECT id, name FROM teachers WHERE center_id = ?').all(C)) as {
    id: number;
    name: string;
  }[])
    teacherId.set(r.name, r.id);
  const rateFrom = toISODate(new Date(T0.getFullYear(), T0.getMonth() - 5, 1));
  for (const [name, rate] of Object.entries(D.PAY_RATES)) {
    const tid = teacherId.get(name);
    if (!tid) continue;
    await tx
      .prepare(
        'INSERT INTO salary_rate_history (teacher_id, effective_from, per_session_amount, changed_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
      )
      .run(tid, rateFrom, rate, admin.id);
    await tx
      .prepare(
        'INSERT INTO salary_rules (teacher_id, per_session_amount) VALUES (?, ?) ON CONFLICT (teacher_id) DO UPDATE SET per_session_amount = excluded.per_session_amount'
      )
      .run(tid, rate);
  }

  /* Lớp mới */
  type Cls = {
    id: number;
    name: string;
    fee: number;
    start: string;
    end: string;
    finished: boolean;
    subject: string;
  };
  const startOffset: Record<string, number> = {
    'IELTS Foundation 5.0': -63,
    'Tiếng Anh Thiếu nhi Starters': -56,
    'Tiếng Hàn Sơ cấp 1': -42,
    'TOEIC 650+': -70,
    'Tiếng Trung HSK 3': -35,
    'Tiếng Anh Giao Tiếp B1': -21,
    'IELTS Writing Intensive': -120,
  };
  const newClasses: Cls[] = [];
  for (const c of D.CLASSES) {
    const start = day(startOffset[c.name]);
    const end = c.finished ? day(-14) : shift(start, 150);
    const id = await ins(
      `INSERT INTO classes (name, teacher_id, room_id, schedule, start_date, end_date, tuition_fee, max_students, status, center_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      c.name,
      teacherId.get(c.teacher),
      c.room ? roomId.get(c.room) : null,
      JSON.stringify(c.slots),
      start,
      end,
      c.fee,
      c.max,
      C,
      at(shift(start, -12), 9)
    );
    await generateSessionsForClass(id, { q: tx });
    if (c.finished) await tx.prepare("UPDATE classes SET status = 'inactive' WHERE id = ?").run(id);
    newClasses.push({
      id,
      name: c.name,
      fee: c.fee,
      start,
      end,
      finished: !!c.finished,
      subject: D.CLASS_SUBJECT[c.name],
    });
    bump('lớp');
    audits.push({
      action: 'create',
      entity: 'classes',
      entityId: id,
      summary: `Tạo lớp ${c.name}`,
      at: at(shift(start, -12), 9),
    });
  }
  const byName = new Map(newClasses.map((c) => [c.name, c]));

  /* Học viên mới + ghi danh. Nhóm tuổi: 0–14 thiếu nhi, 15–30 THPT, 31–59 người đi làm/sinh viên */
  const plan: Record<string, number[]> = {
    'Tiếng Anh Thiếu nhi Starters': range(0, 14),
    'IELTS Foundation 5.0': range(15, 27),
    'IELTS Writing Intensive': range(22, 30),
    'TOEIC 650+': range(31, 42),
    'Tiếng Hàn Sơ cấp 1': range(43, 52),
    'Tiếng Trung HSK 3': [31, ...range(53, 59)],
    'Tiếng Anh Giao Tiếp B1': range(36, 46),
  };
  const enrolledAt = new Map<string, string>(); // `${idx}:${class}` -> ISO
  const firstEnroll: string[] = [];
  for (const [cls, idxs] of Object.entries(plan)) {
    const k = byName.get(cls)!;
    for (const i of idxs) {
      const e = shift(k.start, -int(1, 6));
      enrolledAt.set(`${i}:${cls}`, e);
      firstEnroll[i] = firstEnroll[i] ? minDate(firstEnroll[i], e) : e;
    }
  }
  const parentOfChild = new Map<number, (typeof D.PARENTS)[number]>();
  for (const p of D.PARENTS) for (const ch of p.children) parentOfChild.set(ch, p);
  for (const p of D.PARENTS) usedPhones.add(p.phone);
  for (const r of (await tx.prepare('SELECT phone FROM students WHERE center_id = ?').all(C)) as {
    phone: string | null;
  }[])
    if (r.phone) usedPhones.add(r.phone);

  const maxCode = (await tx
    .prepare(
      "SELECT COALESCE(MAX(substring(code from 3)::int), 0) AS n FROM students WHERE center_id = ? AND code ~ '^HV[0-9]{1,9}$'"
    )
    .get(C)) as { n: number };
  const studentIds: number[] = [];
  for (const [i, name] of D.STUDENT_NAMES.entries()) {
    const code = `HV${String(maxCode.n + i + 1).padStart(3, '0')}`;
    const dob =
      i <= 14
        ? `${int(2016, 2018)}-${pad(int(1, 12))}-${pad(int(1, 28))}`
        : i <= 30
          ? `${int(2008, 2011)}-${pad(int(1, 12))}-${pad(int(1, 28))}`
          : `${int(1993, 2004)}-${pad(int(1, 12))}-${pad(int(1, 28))}`;
    const status = i === 29 || i === 30 ? 'quit' : i === 50 || i === 57 ? 'paused' : 'studying';
    const note =
      i === 29
        ? 'Đã hoàn thành khóa Writing, chuyển sang luyện thi tại trường'
        : i === 50
          ? 'Tạm nghỉ 1 tháng vì đi công tác'
          : i === 57
            ? 'Bảo lưu đến tháng sau'
            : null;
    const created = firstEnroll[i] ?? day(-30);
    const id = await ins(
      'INSERT INTO students (code, name, phone, email, dob, address, status, note, center_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      code,
      name,
      parentOfChild.get(i)?.phone ?? phone(),
      i > 30 && rand() < 0.6 ? `${slug(name)}@gmail.com` : null,
      dob,
      `${int(12, 420)} ${pick(D.STREETS)}, ${pick(D.DISTRICTS)}, TP.HCM`,
      status,
      note,
      C,
      at(shift(created, -1), 10)
    );
    studentIds.push(id);
    bump('học viên');
    audits.push({
      action: 'create',
      entity: 'students',
      entityId: id,
      summary: `Thêm học viên ${code} - ${name}`,
      at: at(shift(created, -1), 10),
    });
  }
  for (const [cls, idxs] of Object.entries(plan)) {
    const k = byName.get(cls)!;
    for (const i of idxs) {
      await tx
        .prepare(
          'INSERT INTO enrollments (student_id, class_id, enrolled_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
        )
        .run(studentIds[i], k.id, at(enrolledAt.get(`${i}:${cls}`)!, 10));
      bump('ghi danh');
    }
  }

  /* Tất cả lớp của trung tâm (cũ + mới) để điểm danh, học phí, bài tập */
  const allClasses = (await tx
    .prepare(
      'SELECT id, name, tuition_fee, start_date, end_date, status FROM classes WHERE center_id = ? ORDER BY id'
    )
    .all(C)) as {
    id: number;
    name: string;
    tuition_fee: number;
    start_date: string;
    end_date: string;
    status: string;
  }[];
  const roster = async (classId: number) =>
    (await tx
      .prepare(
        `SELECT e.student_id, e.enrolled_at, s.code, s.name, s.phone FROM enrollments e JOIN students s ON s.id = e.student_id
         WHERE e.class_id = ? AND e.status = 'active' ORDER BY s.code`
      )
      .all(classId)) as {
      student_id: number;
      enrolled_at: string;
      code: string;
      name: string;
      phone: string | null;
    }[];

  /* Điểm danh + chủ đề buổi học cho mọi buổi đã qua */
  for (const cls of allClasses) {
    const subject = D.CLASS_SUBJECT[cls.name] ?? 'default';
    const topics = TOPICS[subject] ?? TOPICS.default;
    const sessions = (await tx
      .prepare(
        "SELECT id, date, topic FROM sessions WHERE class_id = ? AND date < ? AND status = 'scheduled' ORDER BY date"
      )
      .all(cls.id, TODAY)) as { id: number; date: string; topic: string | null }[];
    const students = await roster(cls.id);
    for (const [si, s] of sessions.entries()) {
      if (!s.topic)
        await tx.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topics[si % topics.length], s.id);
      for (const st of students) {
        if (st.enrolled_at.slice(0, 10) > s.date) continue;
        const r = rand();
        const status = r < 0.87 ? 'present' : r < 0.94 ? 'late' : 'absent';
        const note =
          status === 'absent' && rand() < 0.5
            ? pick(['Phụ huynh báo ốm', 'Nghỉ có phép', 'Không liên lạc được'])
            : null;
        const res = await tx
          .prepare(
            'INSERT INTO attendance (session_id, student_id, status, note) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, student_id) DO NOTHING'
          )
          .run(s.id, st.student_id, status, note);
        if (res.changes) bump('điểm danh');
      }
    }
  }

  /* Học phí: mỗi ghi danh chưa có hóa đơn cho đúng lớp đó -> 1 phiếu thu; trả đủ / một phần / chưa trả */
  const invoiceOf = new Map<string, { id: number; status: string; amount: number }>(); // `${student}:${class}`
  for (const cls of allClasses) {
    const finished = cls.status === 'inactive';
    for (const st of await roster(cls.id)) {
      const exists = await tx
        .prepare('SELECT id FROM invoices WHERE student_id = ? AND class_id = ?')
        .get(st.student_id, cls.id);
      if (exists) continue;
      const enrolled = st.enrolled_at.slice(0, 10);
      const due = shift(enrolled, 14);
      const r = rand();
      let paidPlan: number[] = [];
      if (finished || (due < TODAY && r < 0.7) || (due >= TODAY && r < 0.35))
        paidPlan = rand() < 0.2 ? [0.5, 0.5] : [1];
      else if ((due < TODAY && r < 0.84) || (due >= TODAY && r < 0.55)) paidPlan = [rand() < 0.5 ? 0.5 : 0.4];
      const amount = cls.tuition_fee;
      const paid = paidPlan.reduce((a, b) => a + b, 0) * amount;
      const status = paid >= amount - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      const created = at(enrolled, 9);
      const invId = await ins(
        'INSERT INTO invoices (student_id, class_id, amount, due_date, status, note, center_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        st.student_id,
        cls.id,
        amount,
        due,
        status,
        `Học phí khóa ${cls.name}`,
        C,
        created
      );
      invoiceOf.set(`${st.student_id}:${cls.id}`, { id: invId, status, amount });
      bump('hóa đơn');
      audits.push({
        action: 'create',
        entity: 'invoices',
        entityId: invId,
        summary: `Tạo phiếu thu HD${invId}: ${vnd(amount)}`,
        at: created,
      });
      let payDay = shift(enrolled, int(0, 9));
      for (const [pi, part] of paidPlan.entries()) {
        if (payDay > TODAY) payDay = TODAY;
        const m = method();
        const amt = Math.round(amount * part);
        const paidAt = at(payDay, int(8, 19));
        await tx
          .prepare(
            "INSERT INTO payments (invoice_id, amount, paid_at, method, note, status) VALUES (?, ?, ?, ?, ?, 'confirmed')"
          )
          .run(invId, amt, paidAt, m, paidPlan.length > 1 || part < 1 ? `Đợt ${pi + 1}` : '');
        bump('thanh toán');
        audits.push({
          action: 'payment',
          entity: 'invoices',
          entityId: invId,
          summary: `Thu ${vnd(amt)} cho HD${invId} (${m})`,
          at: paidAt,
        });
        payDay = shift(payDay, int(10, 25));
      }
    }
  }

  /* Phụ huynh + liên kết con */
  const hash = bcrypt.hashSync('123456', 10);
  const parentIds: number[] = [];
  for (const [pi, p] of D.PARENTS.entries()) {
    const id = await ins(
      'INSERT INTO parents (center_id, phone, password_hash, name, referral_code, zalo_consent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      C,
      p.phone,
      hash,
      p.name,
      `GT${String(4821 + pi * 137).padStart(6, '0')}`,
      pi % 3 === 0 ? 'unknown' : 'granted',
      at(day(-int(20, 60)), 20)
    );
    parentIds.push(id);
    for (const ch of p.children)
      await tx
        .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(id, studentIds[ch]);
    bump('phụ huynh');
  }
  const demoParent = (await tx
    .prepare('SELECT id FROM parents WHERE center_id = ? AND phone = ?')
    .get(C, '0900000001')) as { id: number } | undefined;
  const demoKids = (await tx
    .prepare(
      'SELECT s.id, s.code FROM students s JOIN parent_students ps ON ps.student_id = s.id WHERE ps.parent_id = ? ORDER BY s.code'
    )
    .all(demoParent?.id ?? 0)) as { id: number; code: string }[];

  /* Đánh giá: phụ huynh demo + 4 phụ huynh mới; đánh giá cuối đang chờ duyệt */
  const reviewers = [demoParent?.id, ...parentIds].filter((x): x is number => !!x);
  for (const [i, r] of D.REVIEWS.entries()) {
    if (!reviewers[i]) break;
    await tx
      .prepare(
        'INSERT INTO reviews (center_id, parent_id, rating, comment, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
      )
      .run(
        C,
        reviewers[i],
        r.rating,
        r.comment,
        r.approve ? 'approved' : 'pending',
        at(day(-int(1, 40)), 21)
      );
    bump('đánh giá');
  }

  /* Đơn xin nghỉ */
  const classOf = async (studentId: number) =>
    (
      (await tx
        .prepare(
          "SELECT class_id FROM enrollments WHERE student_id = ? AND status = 'active' ORDER BY id LIMIT 1"
        )
        .get(studentId)) as { class_id: number } | undefined
    )?.class_id ?? null;
  const leaves: { student: number | undefined; from: number; to: number; status: string; reason: string }[] =
    [
      { student: demoKids[1]?.id, from: 2, to: 2, status: 'pending', reason: D.LEAVE_REASONS[1] },
      { student: studentIds[2], from: 6, to: 7, status: 'pending', reason: D.LEAVE_REASONS[2] },
      { student: studentIds[16], from: 1, to: 1, status: 'pending', reason: D.LEAVE_REASONS[3] },
      { student: studentIds[0], from: -9, to: -8, status: 'approved', reason: D.LEAVE_REASONS[0] },
      { student: studentIds[4], from: -16, to: -16, status: 'rejected', reason: 'Đi chơi cùng gia đình' },
    ];
  for (const l of leaves) {
    if (!l.student) continue;
    const decided = l.status !== 'pending';
    await tx
      .prepare(
        'INSERT INTO leave_requests (center_id, student_id, class_id, from_date, to_date, reason, status, decided_by, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        C,
        l.student,
        await classOf(l.student),
        day(l.from),
        day(l.to),
        l.reason,
        l.status,
        decided ? admin.id : null,
        decided ? at(day(Math.min(l.from - 1, 0)), 9) : null,
        at(day(Math.min(l.from - 3, -1)), 20)
      );
    bump('đơn nghỉ');
  }

  /* Lead + đăng ký học thử */
  const sources = ['Facebook Ads', 'Landing page', 'Giới thiệu', 'Zalo OA', 'Đến trực tiếp', 'Google'];
  for (const [i, l] of D.LEADS.entries()) {
    await tx
      .prepare(
        'INSERT INTO leads (center_id, name, phone, source, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        C,
        l.name,
        l.phone,
        sources[i % sources.length],
        l.status,
        l.note || null,
        at(day(-int(0, 24)), int(8, 21))
      );
    bump('lead');
  }
  for (const [i, t] of D.TRIALS.entries()) {
    const cls = allClasses.find((c) => c.name === t.course);
    await tx
      .prepare(
        'INSERT INTO trial_registrations (center_id, name, phone, class_id, desired_date, note, referral_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        C,
        t.name,
        t.phone,
        cls?.id ?? null,
        day(int(2, 9)),
        t.note || null,
        i === 3 ? 'GTDEMO01' : null,
        i < 2 ? 'contacted' : 'new',
        at(day(-int(0, 6)), int(9, 21))
      );
    bump('học thử');
  }

  /* Giới thiệu: phụ huynh demo giới thiệu 1 học viên đã đóng đủ (đã thưởng) + 1 đang chờ */
  if (demoParent) {
    const referred = studentIds[37];
    const inv = [...invoiceOf.entries()].find(
      ([k, v]) => k.startsWith(`${referred}:`) && v.status === 'paid'
    )?.[1];
    if (inv) {
      await tx
        .prepare(
          "INSERT INTO referrals (referrer_parent_id, referred_phone, referred_student_id, center_id, status, created_at) VALUES (?, ?, ?, ?, 'rewarded', ?)"
        )
        .run(demoParent.id, null, referred, C, at(day(-40), 19));
      await tx
        .prepare(
          'INSERT INTO credits (parent_id, amount, reason, center_id, source_invoice_id, created_at) VALUES (?, 200000, ?, ?, ?, ?)'
        )
        .run(demoParent.id, `Thưởng giới thiệu học viên mới (HD${inv.id})`, C, inv.id, at(day(-18), 10));
      bump('giới thiệu');
    }
    await tx
      .prepare(
        "INSERT INTO referrals (referrer_parent_id, referred_phone, center_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
      )
      .run(demoParent.id, D.TRIALS[3].phone, C, at(day(-2), 20));
    bump('giới thiệu');
  }
  if (parentIds[0]) {
    await tx
      .prepare(
        "INSERT INTO referrals (referrer_parent_id, referred_phone, center_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
      )
      .run(parentIds[0], D.LEADS[5].phone, C, at(day(-5), 21));
    bump('giới thiệu');
  }

  /* Ngân hàng câu hỏi */
  const bankBySubject = new Map<string, (typeof D.BANK_QUESTIONS)[number][]>();
  for (const q of D.BANK_QUESTIONS) {
    const qid = await ins(
      'INSERT INTO question_bank (center_id, tag, subject, difficulty, qtype, question, points, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      C,
      q.tag,
      q.subject,
      q.difficulty,
      q.qtype,
      q.question,
      q.points,
      admin.id,
      at(day(-int(15, 60)), 21)
    );
    for (const [oi, o] of q.options.entries())
      await tx
        .prepare(
          'INSERT INTO question_bank_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
        )
        .run(qid, oi, o.text, o.is_correct ? 1 : 0);
    if (!bankBySubject.has(q.subject)) bankBySubject.set(q.subject, []);
    bankBySubject.get(q.subject)!.push(q);
    bump('câu hỏi');
  }

  /* Bài tập + quiz cho từng lớp */
  const insertHomework = async (
    classId: number,
    o: {
      title: string;
      content: string | null;
      due: string | null;
      status: string;
      kind: string;
      max: number | null;
      created: string;
      publishAt?: string;
      maxAttempts?: number;
    }
  ) =>
    ins(
      'INSERT INTO homework (center_id, class_id, title, content, due_date, status, publish_at, max_score, kind, max_attempts, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      C,
      classId,
      o.title,
      o.content,
      o.due,
      o.status,
      o.publishAt ?? null,
      o.max,
      o.kind,
      o.maxAttempts ?? null,
      admin.id,
      at(o.created, int(8, 22))
    );
  const submitAndGrade = async (
    hwId: number,
    students: { student_id: number }[],
    due: string,
    rate: number,
    gradeRate: number
  ) => {
    for (const st of students) {
      if (rand() > rate) continue;
      const when = at(shift(due, -int(0, 3)), int(18, 23));
      await tx
        .prepare(
          'INSERT INTO homework_submissions (homework_id, student_id, note, submitted_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
        )
        .run(
          hwId,
          st.student_id,
          pick([
            'Con đã làm xong, nhờ cô xem giúp ạ.',
            'Bài làm đính kèm trong vở, gửi ảnh qua Zalo lớp.',
            'Đã hoàn thành.',
            'Em nộp bài ạ.',
          ]),
          when
        );
      await tx
        .prepare(
          "INSERT INTO homework_completions (homework_id, student_id, completed_by, completed_at) VALUES (?, ?, 'parent', ?) ON CONFLICT DO NOTHING"
        )
        .run(hwId, st.student_id, when);
      bump('bài nộp');
      if (due < TODAY && rand() < gradeRate) {
        await tx
          .prepare(
            'INSERT INTO homework_scores (homework_id, student_id, score, feedback, graded_at, graded_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
          )
          .run(
            hwId,
            st.student_id,
            int(11, 20) / 2,
            pick(D.HOMEWORK_FEEDBACK) || null,
            at(shift(due, int(1, 3)), 21),
            admin.id
          );
        bump('điểm bài tập');
      }
    }
  };
  const demoKidIds = new Set(demoKids.map((k) => k.id));
  for (const cls of allClasses) {
    const subject = D.CLASS_SUBJECT[cls.name] ?? 'Tiếng Anh';
    const texts = D.HOMEWORK_TEXT[subject] ?? D.HOMEWORK_TEXT['Tiếng Anh'];
    const students = await roster(cls.id);
    const finished = cls.status === 'inactive';
    if (finished) {
      for (const [i, [title, content]] of texts.entries()) {
        const due = shift(cls.end_date, -20 + i * 10);
        const hw = await insertHomework(cls.id, {
          title,
          content,
          due,
          status: 'published',
          kind: 'homework',
          max: 10,
          created: shift(due, -7),
        });
        await submitAndGrade(hw, students, due, 0.95, 1);
        bump('bài tập');
      }
      continue;
    }
    // 1. Bài đã hết hạn, đã chấm phần lớn
    const due1 = day(-10);
    const hw1 = await insertHomework(cls.id, {
      title: texts[0][0],
      content: texts[0][1],
      due: due1,
      status: 'published',
      kind: 'homework',
      max: 10,
      created: day(-17),
    });
    await submitAndGrade(hw1, students, due1, 0.85, 0.85);
    bump('bài tập');
    // 2. Quiz đã hết hạn (vẫn làm được vì không có hạn đóng), 2 lượt làm
    const pool = (bankBySubject.get(subject) ?? []).filter((q) => q.qtype !== 'essay').slice(0, 4);
    if (pool.length) {
      const due2 = day(-3);
      const maxScore = pool.reduce((a, q) => a + q.points, 0);
      const quiz = await insertHomework(cls.id, {
        title: `Quiz ôn tập ${subject} – tuần ${Math.max(1, Math.round((T0.getTime() - parseISODate(cls.start_date).getTime()) / 6048e5))}`,
        content: 'Làm trong 15 phút, được làm tối đa 2 lần, hệ thống lấy điểm cao nhất.',
        due: due2,
        status: 'published',
        kind: 'quiz',
        max: maxScore,
        created: day(-9),
        maxAttempts: 2,
      });
      const qs: { id: number; points: number; qtype: string; opts: { id: number; correct: boolean }[] }[] =
        [];
      for (const [pos, q] of pool.entries()) {
        const qid = await ins(
          'INSERT INTO quiz_questions (homework_id, position, qtype, question, points) VALUES (?, ?, ?, ?, ?)',
          quiz,
          pos,
          q.qtype,
          q.question,
          q.points
        );
        const opts: { id: number; correct: boolean }[] = [];
        for (const [oi, o] of q.options.entries())
          opts.push({
            id: await ins(
              'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)',
              qid,
              oi,
              o.text,
              o.is_correct ? 1 : 0
            ),
            correct: o.is_correct,
          });
        qs.push({ id: qid, points: q.points, qtype: q.qtype, opts });
      }
      for (const st of students) {
        // Con thứ hai của phụ huynh demo chưa làm quiz -> cổng phụ huynh có nút "Làm bài ngay"
        if (demoKidIds.has(st.student_id) ? st.student_id === demoKids[1]?.id : rand() > 0.72) continue;
        let score = 0;
        const when = at(shift(due2, -int(0, 4)), int(19, 22));
        const attempt = await ins(
          'INSERT INTO quiz_attempts (homework_id, student_id, score, max_score, submitted_at) VALUES (?, ?, 0, ?, ?)',
          quiz,
          st.student_id,
          maxScore,
          when
        );
        for (const q of qs) {
          const right = rand() < 0.74;
          const correct = q.opts.filter((o) => o.correct);
          const wrong = q.opts.filter((o) => !o.correct);
          const chosen = right
            ? correct
            : q.qtype === 'multiple'
              ? [correct[0], wrong[0]].filter(Boolean)
              : [pick(wrong)];
          for (const o of chosen)
            await tx
              .prepare('INSERT INTO quiz_answers (attempt_id, question_id, option_id) VALUES (?, ?, ?)')
              .run(attempt, q.id, o.id);
          if (right) score += q.points;
        }
        await tx.prepare('UPDATE quiz_attempts SET score = ? WHERE id = ?').run(score, attempt);
        await tx
          .prepare(
            'INSERT INTO homework_scores (homework_id, student_id, score, graded_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
          )
          .run(quiz, st.student_id, score, when);
        await tx
          .prepare(
            "INSERT INTO homework_completions (homework_id, student_id, completed_by, completed_at) VALUES (?, ?, 'student', ?) ON CONFLICT DO NOTHING"
          )
          .run(quiz, st.student_id, when);
        bump('lượt làm quiz');
      }
      bump('bài tập');
    }
    // 3. Bài sắp đến hạn, mới vài em nộp
    const [t2, c2] = texts[1] ?? [
      `Ôn tập ${subject} – phiếu số 2`,
      'Hoàn thành phiếu bài tập phát trên lớp.',
    ];
    const due3 = day(3);
    const hw3 = await insertHomework(cls.id, {
      title: t2,
      content: c2,
      due: due3,
      status: 'published',
      kind: 'homework',
      max: 10,
      created: day(-2),
    });
    await submitAndGrade(
      hw3,
      students.filter((s) => !demoKidIds.has(s.student_id)),
      due3,
      0.25,
      0
    );
    bump('bài tập');
    // 4. Nháp / hẹn giờ ở vài lớp
    if (cls.id % 3 === 0) {
      await insertHomework(cls.id, {
        title: 'Đề cương ôn tập cuối khóa',
        content: 'Bản nháp, bổ sung phần Listening trước khi giao.',
        due: null,
        status: 'draft',
        kind: 'homework',
        max: 10,
        created: day(-1),
      });
      bump('bài tập');
    } else if (cls.id % 3 === 1) {
      await insertHomework(cls.id, {
        title: 'Mock test giữa khóa',
        content: 'Làm tại nhà trong 60 phút, không tra từ điển.',
        due: day(9),
        status: 'scheduled',
        publishAt: `${day(2)}T07:00`,
        kind: 'homework',
        max: 10,
        created: day(-1),
      });
      bump('bài tập');
    }
  }

  /* Điểm kiểm tra (tab Điểm số) */
  for (const cls of allClasses) {
    if (cls.start_date > day(-28)) continue;
    const ielts = /IELTS/.test(cls.name);
    const finished = cls.status === 'inactive';
    const when = finished ? shift(cls.end_date, -3) : day(-7);
    for (const st of await roster(cls.id)) {
      await tx
        .prepare(
          'INSERT INTO grades (center_id, student_id, class_id, title, score, max_score, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          C,
          st.student_id,
          cls.id,
          finished ? 'Kiểm tra cuối khóa' : 'Kiểm tra giữa khóa',
          int(10, 19) / 2,
          10,
          pick([
            'Nắm bài tốt',
            'Cần luyện thêm phần nghe',
            'Tiến bộ so với đầu khóa',
            'Chú ý ngữ pháp',
            null,
          ]),
          admin.id,
          at(when, 20)
        );
      bump('điểm kiểm tra');
      if (ielts) {
        await tx
          .prepare(
            'INSERT INTO grades (center_id, student_id, class_id, title, score, max_score, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            C,
            st.student_id,
            cls.id,
            'Mock test Reading (band)',
            int(9, 14) / 2,
            9,
            null,
            admin.id,
            at(shift(when, -14), 20)
          );
        bump('điểm kiểm tra');
      }
    }
  }

  /* Nhắc học phí qua Zalo (chế độ demo: chưa cấu hình Zalo OA nên không gửi thật) */
  const unpaid = (await tx
    .prepare(
      `SELECT i.id, i.student_id, i.due_date, i.amount, s.name, s.phone FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.center_id = ? AND i.status <> 'paid' AND s.phone IS NOT NULL ORDER BY i.due_date LIMIT 10`
    )
    .all(C)) as {
    id: number;
    student_id: number;
    due_date: string;
    amount: number;
    name: string;
    phone: string;
  }[];
  for (const inv of unpaid) {
    const overdue = inv.due_date < TODAY;
    await tx
      .prepare(
        "INSERT INTO reminders (center_id, invoice_id, student_id, phone, kind, status, message, created_at) VALUES (?, ?, ?, ?, ?, 'demo', ?, ?)"
      )
      .run(
        C,
        inv.id,
        inv.student_id,
        inv.phone,
        overdue ? 'overdue' : 'upcoming',
        overdue
          ? `Học phí HD${inv.id} của ${inv.name} đã quá hạn ngày ${inv.due_date.split('-').reverse().join('/')}. Vui lòng thanh toán sớm.`
          : `Nhắc học phí HD${inv.id} của ${inv.name}: hạn ${inv.due_date.split('-').reverse().join('/')}.`,
        at(day(-int(0, 5)), 9)
      );
    bump('nhắc Zalo');
  }

  /* Nhật ký thao tác (Nhật ký) */
  for (let d = -13; d <= 0; d++)
    audits.push({
      action: 'login',
      entity: 'users',
      entityId: admin.id,
      summary: `${admin.name} đăng nhập`,
      at: at(day(d), int(7, 9)),
    });
  for (const a of audits.sort((x, y) => (x.at < y.at ? -1 : 1))) {
    if (a.at.slice(0, 10) > TODAY) continue;
    await tx
      .prepare(
        'INSERT INTO audit_logs (center_id, actor_id, actor_name, actor_role, action, entity, entity_id, summary, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(C, admin.id, admin.name, 'admin', a.action, a.entity, a.entityId, a.summary, '127.0.0.1', a.at);
  }
  bump('nhật ký', audits.length);
  return count;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
function slug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .split(' ');
  return `${s[s.length - 1]}.${s[0]}${int(90, 99)}`;
}

async function main(): Promise<void> {
  const marker = await db.prepare('SELECT 1 FROM teachers WHERE email = ?').get(D.TEACHERS[0].email);
  if (marker) {
    console.log('Dữ liệu trình diễn đã có (thấy giáo viên ' + D.TEACHERS[0].name + '), không chạy lại.');
    return;
  }
  const count = await db.transaction(run);
  console.log('Đã thêm:');
  for (const [k, v] of Object.entries(count)) console.log(`  ${k}: ${v}`);
  const issues = await checkFinancialConsistency(db);
  console.log(
    issues.length
      ? `Đối soát tài chính: ${issues.length} vấn đề\n${issues.map((i) => '  ' + i.detail).join('\n')}`
      : 'Đối soát tài chính: không lệch.'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
