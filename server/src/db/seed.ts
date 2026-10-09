/* eslint-disable no-console -- seed script: output trực tiếp cho người chạy */
import bcrypt from 'bcryptjs';
import { db } from './connection';
import { ensureDemoCenter, generateSessionsForClass } from './helpers';
import { toISODate, addDays, ourDayOfWeek, parseISODate } from './date-utils';
import { recalcInvoiceStatus } from './helpers';

/** Dữ liệu demo cho lần chạy đầu tiên. */
/** Seed dữ liệu demo — chỉ chạy khi DB trống. */
export function seedDatabase(): void {
  const demoId = ensureDemoCenter();
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (count === 0) {
    console.log('Đang tạo dữ liệu demo...');

    const adminHash = bcrypt.hashSync('123456', 10);
    db.prepare(
      'INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, ?, ?, ?)'
    ).run('admin', adminHash, 'admin', 'Quản trị viên', demoId);

    const addTeacher = db.prepare(
      'INSERT INTO teachers (name, phone, email, subject, center_id) VALUES (?, ?, ?, ?, ?)'
    );
    addTeacher.run('Nguyễn Văn An', '0901112223', 'an.nv@educenter.vn', 'Tiếng Anh', demoId);
    addTeacher.run('Trần Thị Bình', '0904445556', 'binh.tt@educenter.vn', 'Tiếng Nhật', demoId);
    addTeacher.run('Lê Văn Cường', '0907778889', 'cuong.lv@educenter.vn', 'IELTS', demoId);

    const studentNames = [
      'Phạm Minh Tuấn',
      'Hoàng Thị Lan',
      'Đỗ Văn Hùng',
      'Vũ Thị Mai',
      'Bùi Đức Anh',
      'Ngô Thị Hoa',
      'Dương Văn Nam',
      'Lý Thị Ngọc',
      'Trịnh Văn Phúc',
      'Phan Thị Thảo',
      'Tống Minh Đức',
      'Đinh Thị Yến',
    ];
    const addStudent = db.prepare(
      'INSERT INTO students (code, name, phone, email, dob, address, status, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    studentNames.forEach((name, i) => {
      const n = i + 1;
      const status = n === 11 ? 'paused' : n === 12 ? 'quit' : 'studying';
      addStudent.run(
        `HV${String(n).padStart(3, '0')}`,
        name,
        `0912${String(100000 + n * 137).slice(0, 6)}`,
        null,
        `200${n % 10}-0${(n % 9) + 1}-1${n % 9}`,
        `Số ${n * 7} đường Lê Lợi, Quận 1, TP.HCM`,
        status,
        demoId
      );
    });

    const today = new Date();
    const todayDow = ourDayOfWeek(today);
    const otherDow = todayDow >= 8 ? 2 : todayDow + 1;
    const startDate = toISODate(addDays(today, -45));
    const endDate = toISODate(addDays(today, 45));

    const addClass = db.prepare(
      'INSERT INTO classes (name, teacher_id, schedule, start_date, end_date, tuition_fee, max_students, status, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // Lớp 1: có lịch học hôm nay để dashboard hiển thị buổi học hôm nay
    addClass.run(
      'Tiếng Anh Giao Tiếp A1',
      1,
      JSON.stringify([
        { day: todayDow, start: '18:00', end: '20:00' },
        { day: otherDow, start: '18:00', end: '20:00' },
      ]),
      startDate,
      endDate,
      2500000,
      20,
      'active',
      demoId
    );
    addClass.run(
      'Tiếng Nhật N5',
      2,
      JSON.stringify([
        { day: 3, start: '19:00', end: '21:00' },
        { day: 6, start: '19:00', end: '21:00' },
      ]),
      startDate,
      endDate,
      3000000,
      15,
      'active',
      demoId
    );
    addClass.run(
      'IELTS 6.5 Cấp tốc',
      3,
      JSON.stringify([{ day: 7, start: '08:00', end: '11:00' }]),
      startDate,
      endDate,
      5500000,
      12,
      'active',
      demoId
    );

    const enroll = db.prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)');
    [1, 2, 3, 4, 5, 6].forEach((s) => enroll.run(s, 1));
    [4, 5, 7, 8].forEach((s) => enroll.run(s, 2));
    [6, 9, 10, 11, 12].forEach((s) => enroll.run(s, 3));

    // Sinh buổi học cho các lớp
    generateSessionsForClass(1);
    generateSessionsForClass(2);
    generateSessionsForClass(3);

    // Điểm danh cho các buổi đã qua của lớp 1 (tối đa 6 buổi gần nhất)
    const pastSessions = db
      .prepare("SELECT id FROM sessions WHERE class_id = 1 AND date < date('now') ORDER BY date DESC LIMIT 6")
      .all() as { id: number }[];
    const class1Students = db
      .prepare('SELECT student_id FROM enrollments WHERE class_id = 1 AND status = ?')
      .all('active') as { student_id: number }[];
    const addAtt = db.prepare(
      'INSERT OR IGNORE INTO attendance (session_id, student_id, status) VALUES (?, ?, ?)'
    );
    for (const sess of pastSessions) {
      for (const st of class1Students) {
        const r = (st.student_id * 7 + sess.id * 13) % 20;
        const status = r < 16 ? 'present' : r < 18 ? 'late' : 'absent';
        addAtt.run(sess.id, st.student_id, status);
      }
    }
    // Gán topic cho vài buổi đã qua
    const topics = [
      'Giới thiệu & làm quen',
      'Chào hỏi cơ bản',
      'Gia đình & bạn bè',
      'Mua sắm',
      'Du lịch',
      'Ôn tập giữa khóa',
    ];
    pastSessions.forEach((sess, i) => {
      db.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topics[i % topics.length], sess.id);
    });

    // Hóa đơn + thanh toán demo
    const addInvoice = db.prepare(
      "INSERT INTO invoices (student_id, class_id, amount, due_date, status, note, created_at) VALUES (?, ?, ?, ?, 'unpaid', ?, datetime('now'))"
    );
    const addPayment = db.prepare(
      "INSERT INTO payments (invoice_id, amount, paid_at, method, note, status) VALUES (?, ?, ?, ?, ?, 'confirmed')"
    );
    const thisMonth = toISODate(today).slice(0, 7); // YYYY-MM
    const mk = (
      studentId: number,
      classId: number,
      amount: number,
      dueInDays: number,
      note: string
    ): number => {
      const r = addInvoice.run(studentId, classId, amount, toISODate(addDays(today, dueInDays)), note);
      return Number(r.lastInsertRowid);
    };
    // 1: đã thanh toán đủ (trong tháng này)
    let id = mk(1, 1, 2500000, -10, 'Học phí khóa A1');
    addPayment.run(id, 2500000, `${thisMonth}-05 09:30:00`, 'Tiền mặt', '');
    // 2: thanh toán một phần
    id = mk(2, 1, 2500000, 5, 'Học phí khóa A1');
    addPayment.run(id, 1000000, `${thisMonth}-08 14:00:00`, 'Chuyển khoản', 'Đợt 1');
    // 3: chưa thanh toán
    mk(3, 1, 2500000, 7, 'Học phí khóa A1');
    // 4: đã thanh toán đủ (tháng này)
    id = mk(4, 2, 3000000, -12, 'Học phí N5');
    addPayment.run(id, 3000000, `${thisMonth}-03 10:15:00`, 'Chuyển khoản', '');
    // 5: chưa thanh toán, quá hạn
    mk(5, 2, 3000000, -3, 'Học phí N5');
    // 6: thanh toán một phần
    id = mk(6, 3, 5500000, 10, 'Học phí IELTS');
    addPayment.run(id, 3000000, `${thisMonth}-10 16:45:00`, 'Tiền mặt', 'Đợt 1');
    // 7: chưa thanh toán
    mk(7, 3, 5500000, 12, 'Học phí IELTS');
    // 8: đã thanh toán đủ (tháng trước)
    id = mk(8, 1, 2500000, -40, 'Học phí khóa A1');
    const lastMonth = toISODate(addDays(parseISODate(`${thisMonth}-01`), -15)).slice(0, 7);
    addPayment.run(id, 2500000, `${lastMonth}-20 09:00:00`, 'Tiền mặt', '');
    // Cập nhật trạng thái hóa đơn
    const allInv = db.prepare('SELECT id FROM invoices').all() as { id: number }[];
    allInv.forEach((inv) => recalcInvoiceStatus(inv.id));

    console.log('Đã tạo xong dữ liệu demo.');
  }

  seedExtraAccounts();
}

/** Tài khoản bổ sung (idempotent — chạy được trên DB cũ lẫn mới) */
function seedExtraAccounts(): void {
  const demoId = ensureDemoCenter();
  const hash = bcrypt.hashSync('123456', 10);

  const hasRoot = db.prepare("SELECT 1 FROM users WHERE username = 'root'").get();
  if (!hasRoot) {
    db.prepare(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('root', ?, 'superadmin', 'Quản trị hệ thống', NULL)"
    ).run(hash);
    console.log('Đã tạo tài khoản superadmin: root / 123456');
  }

  const hasTeacher = db.prepare("SELECT 1 FROM users WHERE username = 'teacher1'").get();
  if (!hasTeacher) {
    // Gắn với giáo viên đầu tiên của trung tâm demo (nếu có)
    const t = db
      .prepare('SELECT id FROM teachers WHERE center_id = ? ORDER BY id ASC LIMIT 1')
      .get(demoId) as { id: number } | undefined;
    db.prepare(
      'INSERT INTO users (username, password_hash, role, name, center_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('teacher1', hash, 'teacher', t ? 'Giáo viên demo' : 'teacher1', demoId, t ? t.id : null);
    console.log('Đã tạo tài khoản giáo viên demo: teacher1 / 123456');
  }

  const hasParent = db
    .prepare('SELECT 1 FROM parents WHERE phone = ? AND center_id = ?')
    .get('0900000001', demoId);
  if (!hasParent) {
    const r = db
      .prepare(
        'INSERT INTO parents (center_id, phone, password_hash, name, referral_code) VALUES (?, ?, ?, ?, ?)'
      )
      .run(demoId, '0900000001', hash, 'Phụ huynh Demo', 'GTDEMO01');
    const pid = Number(r.lastInsertRowid);
    const link = db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)');
    const s1 = db.prepare('SELECT id FROM students WHERE code = ? AND center_id = ?').get('HV001', demoId) as
      { id: number } | undefined;
    const s2 = db.prepare('SELECT id FROM students WHERE code = ? AND center_id = ?').get('HV002', demoId) as
      { id: number } | undefined;
    if (s1) link.run(pid, s1.id);
    if (s2) link.run(pid, s2.id);
    console.log('Đã tạo tài khoản phụ huynh demo: 0900000001 / 123456 (liên kết HV001, HV002)');
  }

  // Vài phòng học mẫu
  const roomCount = (
    db.prepare('SELECT COUNT(*) as c FROM rooms WHERE center_id = ?').get(demoId) as { c: number }
  ).c;
  if (roomCount === 0) {
    const addRoom = db.prepare('INSERT INTO rooms (center_id, name, capacity) VALUES (?, ?, ?)');
    addRoom.run(demoId, 'Phòng A101', 20);
    addRoom.run(demoId, 'Phòng A102', 15);
    addRoom.run(demoId, 'Phòng B201', 25);
  }
}
