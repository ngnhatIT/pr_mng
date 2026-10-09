/* eslint-disable no-console -- seed script: output trực tiếp cho người chạy */
import bcrypt from 'bcryptjs';
import { db } from './connection';
import { ensureDemoCenter, generateSessionsForClass, recalcInvoiceStatus } from './helpers';
import { toISODate, addDays, ourDayOfWeek, parseISODate } from './date-utils';

/** Dữ liệu demo cho lần chạy đầu tiên. */
/** Seed dữ liệu demo — chỉ chạy khi DB trống. */
export async function seedDatabase(): Promise<void> {
  const demoId = await ensureDemoCenter();
  const count = (await db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (count === 0) {
    console.log('Đang tạo dữ liệu demo...');

    const adminHash = bcrypt.hashSync('123456', 10);
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, ?, ?, ?)'
      )
      .run('admin', adminHash, 'admin', 'Quản trị viên', demoId);

    const addTeacher = db.prepare(
      'INSERT INTO teachers (name, phone, email, subject, center_id) VALUES (?, ?, ?, ?, ?)'
    );
    await addTeacher.run('Nguyễn Văn An', '0901112223', 'an.nv@educenter.vn', 'Tiếng Anh', demoId);
    await addTeacher.run('Trần Thị Bình', '0904445556', 'binh.tt@educenter.vn', 'Tiếng Nhật', demoId);
    await addTeacher.run('Lê Văn Cường', '0907778889', 'cuong.lv@educenter.vn', 'IELTS', demoId);

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
    for (const [i, name] of studentNames.entries()) {
      const n = i + 1;
      const status = n === 11 ? 'paused' : n === 12 ? 'quit' : 'studying';
      await addStudent.run(
        `HV${String(n).padStart(3, '0')}`,
        name,
        `0912${String(100000 + n * 137).slice(0, 6)}`,
        null,
        `200${n % 10}-0${(n % 9) + 1}-1${n % 9}`,
        `Số ${n * 7} đường Lê Lợi, Quận 1, TP.HCM`,
        status,
        demoId
      );
    }

    const today = new Date();
    const todayDow = ourDayOfWeek(today);
    const otherDow = todayDow >= 8 ? 2 : todayDow + 1;
    const startDate = toISODate(addDays(today, -45));
    const endDate = toISODate(addDays(today, 45));

    const addClass = db.prepare(
      'INSERT INTO classes (name, teacher_id, schedule, start_date, end_date, tuition_fee, max_students, status, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // Lớp 1: có lịch học hôm nay để dashboard hiển thị buổi học hôm nay
    await addClass.run(
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
    await addClass.run(
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
    await addClass.run(
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
    for (const s of [1, 2, 3, 4, 5, 6]) await enroll.run(s, 1);
    for (const s of [4, 5, 7, 8]) await enroll.run(s, 2);
    for (const s of [6, 9, 10, 11, 12]) await enroll.run(s, 3);

    // Sinh buổi học cho các lớp
    await generateSessionsForClass(1);
    await generateSessionsForClass(2);
    await generateSessionsForClass(3);

    // Điểm danh cho các buổi đã qua của lớp 1 (tối đa 6 buổi gần nhất)
    const pastSessions = (await db
      .prepare("SELECT id FROM sessions WHERE class_id = 1 AND date < date('now') ORDER BY date DESC LIMIT 6")
      .all()) as { id: number }[];
    const class1Students = (await db
      .prepare('SELECT student_id FROM enrollments WHERE class_id = 1 AND status = ?')
      .all('active')) as { student_id: number }[];
    const addAtt = db.prepare(
      'INSERT OR IGNORE INTO attendance (session_id, student_id, status) VALUES (?, ?, ?)'
    );
    for (const sess of pastSessions) {
      for (const st of class1Students) {
        const r = (st.student_id * 7 + sess.id * 13) % 20;
        const status = r < 16 ? 'present' : r < 18 ? 'late' : 'absent';
        await addAtt.run(sess.id, st.student_id, status);
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
    for (const [i, sess] of pastSessions.entries()) {
      await db.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topics[i % topics.length], sess.id);
    }

    // Hóa đơn + thanh toán demo
    const addInvoice = db.prepare(
      "INSERT INTO invoices (student_id, class_id, amount, due_date, status, note, created_at) VALUES (?, ?, ?, ?, 'unpaid', ?, datetime('now'))"
    );
    const addPayment = db.prepare(
      "INSERT INTO payments (invoice_id, amount, paid_at, method, note, status) VALUES (?, ?, ?, ?, ?, 'confirmed')"
    );
    const thisMonth = toISODate(today).slice(0, 7); // YYYY-MM
    const mk = async (
      studentId: number,
      classId: number,
      amount: number,
      dueInDays: number,
      note: string
    ): Promise<number> => {
      const r = await addInvoice.run(studentId, classId, amount, toISODate(addDays(today, dueInDays)), note);
      return Number(r.lastInsertRowid);
    };
    // 1: đã thanh toán đủ (trong tháng này)
    let id = await mk(1, 1, 2500000, -10, 'Học phí khóa A1');
    await addPayment.run(id, 2500000, `${thisMonth}-05 09:30:00`, 'Tiền mặt', '');
    // 2: thanh toán một phần
    id = await mk(2, 1, 2500000, 5, 'Học phí khóa A1');
    await addPayment.run(id, 1000000, `${thisMonth}-08 14:00:00`, 'Chuyển khoản', 'Đợt 1');
    // 3: chưa thanh toán
    await mk(3, 1, 2500000, 7, 'Học phí khóa A1');
    // 4: đã thanh toán đủ (tháng này)
    id = await mk(4, 2, 3000000, -12, 'Học phí N5');
    await addPayment.run(id, 3000000, `${thisMonth}-03 10:15:00`, 'Chuyển khoản', '');
    // 5: chưa thanh toán, quá hạn
    await mk(5, 2, 3000000, -3, 'Học phí N5');
    // 6: thanh toán một phần
    id = await mk(6, 3, 5500000, 10, 'Học phí IELTS');
    await addPayment.run(id, 3000000, `${thisMonth}-10 16:45:00`, 'Tiền mặt', 'Đợt 1');
    // 7: chưa thanh toán
    await mk(7, 3, 5500000, 12, 'Học phí IELTS');
    // 8: đã thanh toán đủ (tháng trước)
    id = await mk(8, 1, 2500000, -40, 'Học phí khóa A1');
    const lastMonth = toISODate(addDays(parseISODate(`${thisMonth}-01`), -15)).slice(0, 7);
    await addPayment.run(id, 2500000, `${lastMonth}-20 09:00:00`, 'Tiền mặt', '');
    // Cập nhật trạng thái hóa đơn
    const allInv = (await db.prepare('SELECT id FROM invoices').all()) as { id: number }[];
    for (const inv of allInv) await recalcInvoiceStatus(inv.id);

    console.log('Đã tạo xong dữ liệu demo.');
  }

  await seedExtraAccounts();
}

/** Tài khoản bổ sung (idempotent — chạy được trên DB cũ lẫn mới) */
async function seedExtraAccounts(): Promise<void> {
  const demoId = await ensureDemoCenter();
  const hash = bcrypt.hashSync('123456', 10);

  const hasRoot = await db.prepare("SELECT 1 FROM users WHERE username = 'root'").get();
  if (!hasRoot) {
    await db
      .prepare(
        "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('root', ?, 'superadmin', 'Quản trị hệ thống', NULL)"
      )
      .run(hash);
    console.log('Đã tạo tài khoản superadmin: root / 123456');
  }

  const hasTeacher = await db.prepare("SELECT 1 FROM users WHERE username = 'teacher1'").get();
  if (!hasTeacher) {
    // Gắn với giáo viên đầu tiên của trung tâm demo (nếu có)
    const t = (await db
      .prepare('SELECT id FROM teachers WHERE center_id = ? ORDER BY id ASC LIMIT 1')
      .get(demoId)) as { id: number } | undefined;
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, role, name, center_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('teacher1', hash, 'teacher', t ? 'Giáo viên demo' : 'teacher1', demoId, t ? t.id : null);
    console.log('Đã tạo tài khoản giáo viên demo: teacher1 / 123456');
  }

  const hasParent = await db
    .prepare('SELECT 1 FROM parents WHERE phone = ? AND center_id = ?')
    .get('0900000001', demoId);
  if (!hasParent) {
    const r = await db
      .prepare(
        'INSERT INTO parents (center_id, phone, password_hash, name, referral_code) VALUES (?, ?, ?, ?, ?)'
      )
      .run(demoId, '0900000001', hash, 'Phụ huynh Demo', 'GTDEMO01');
    const pid = Number(r.lastInsertRowid);
    const link = db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)');
    const s1 = (await db.prepare('SELECT id FROM students WHERE code = ? AND center_id = ?').get('HV001', demoId)) as
      { id: number } | undefined;
    const s2 = (await db.prepare('SELECT id FROM students WHERE code = ? AND center_id = ?').get('HV002', demoId)) as
      { id: number } | undefined;
    if (s1) await link.run(pid, s1.id);
    if (s2) await link.run(pid, s2.id);
    console.log('Đã tạo tài khoản phụ huynh demo: 0900000001 / 123456 (liên kết HV001, HV002)');
  }

  // Vài phòng học mẫu
  const roomCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM rooms WHERE center_id = ?').get(demoId)) as { c: number }
  ).c;
  if (roomCount === 0) {
    const addRoom = db.prepare('INSERT INTO rooms (center_id, name, capacity) VALUES (?, ?, ?)');
    await addRoom.run(demoId, 'Phòng A101', 20);
    await addRoom.run(demoId, 'Phòng A102', 15);
    await addRoom.run(demoId, 'Phòng B201', 25);
  }
}
