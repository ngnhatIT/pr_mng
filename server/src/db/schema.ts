import type { Db } from './connection';

/* =====================================================================================
 * EduCenterPro — CANONICAL DATABASE SCHEMA (single source of truth)
 * =====================================================================================
 *
 * File này là định nghĩa DUY NHẤT của cấu trúc database. Mọi thay đổi cấu trúc
 * đều bắt đầu từ đây, sau đó mới viết migration trong versionedMigrations.ts.
 *
 * QUY ƯỚC (bắt buộc tuân thủ khi thêm bảng/cột mới):
 *
 * 1. Đặt tên: snake_case. Khóa chính `id INTEGER PRIMARY KEY AUTOINCREMENT`,
 *    trừ bảng nối nhiều-nhiều dùng khóa chính复合 (composite PK).
 *    Cột khóa ngoại đặt tên `<bang>_id` (vd: student_id -> students.id).
 *
 * 2. Thời gian: TEXT theo ISO-8601 UTC, DEFAULT (datetime('now')).
 *    Mọi bảng nghiệp vụ chính có `created_at`; bảng hay bị sửa có thêm
 *    `updated_at` và trigger tự động chạm (xem createTriggers).
 *
 * 3. Tiền tệ: REAL, đơn vị VND, luôn có CHECK (amount >= 0).
 *    Boolean: INTEGER với CHECK IN (0, 1).
 *
 * 4. Enum: TEXT + CHECK IN (...) TẠI DATABASE — không chỉ validate ở service.
 *    Giá trị enum phải đồng bộ với const trong service tương ứng
 *    (vd: STUDENT_STATUS, INVOICE_STATUS...). Thêm giá trị mới = migration.
 *
 * 5. CHÍNH SÁCH KHÓA NGOẠI (áp dụng đồng nhất):
 *    - Dữ liệu "sở hữu" (owned children)      -> ON DELETE CASCADE
 *      (attendance, enrollments, payments, homework_*, quiz_*...)
 *      Xóa cha thì con đi theo — đúng với logic xóa thủ công hiện có ở service.
 *    - Tham chiếu "tùy chọn" (optional refs)   -> ON DELETE SET NULL
 *      (classes.teacher_id, homework.created_by...) — giữ lịch sử, null hóa liên kết.
 *    - Phạm vi tenant (center_id)             -> ON DELETE RESTRICT
 *      Không bao giờ được xóa trung tâm còn dữ liệu một cách âm thầm.
 *    - audit_logs: CỐ TÌNH không đặt FK — nhật ký append-only, bất tử.
 *
 * 6. Mọi ràng buộc đều ĐẶT TÊN (CONSTRAINT fk_... / chk_...) để lỗi DB trả về
 *    có thể truy vết, và để validateSchema() kiểm tra được.
 *
 * 7. PRAGMA foreign_keys = ON được bật ở connection.ts — FK thực sự có hiệu lực.
 *    Lưu ý: DB cũ (tạo trước bản này) giữ nguyên định nghĩa bảng cũ vì SQLite
 *    không ALTER được để thêm FK/CHECK; migration v5 chỉ backfill cột mới.
 *    DB cài mới nhận đầy đủ ràng buộc.
 *
 * 8. TABLE_DOCS bên dưới là DATA DICTIONARY sống: tài liệu cho từng bảng/cột,
 *    dùng cho Swagger/admin và được kiểm tra bởi schema.test.ts
 *    (mọi bảng trong DB đều phải có mặt trong dictionary).
 * =================================================================================== */

/** Phiên bản schema mà file này mô tả — phải khớp migration mới nhất. */
export const SCHEMA_VERSION = 5;

/* -------------------------------------------------------------------------------------
 * DATA DICTIONARY — tài liệu sống của toàn bộ database (tiếng Việt).
 * ----------------------------------------------------------------------------------- */
export interface ColumnDoc {
  description: string;
}
export interface TableDoc {
  description: string;
  columns: Record<string, string>;
}

export const TABLE_DOCS: Record<string, TableDoc> = {
  users: {
    description: 'Tài khoản đăng nhập của nhân sự (admin/staff/teacher) và superadmin hệ thống.',
    columns: {
      id: 'Khóa chính.',
      username: 'Tên đăng nhập, duy nhất toàn hệ thống.',
      password_hash: 'Mật khẩu đã băm bcrypt — không bao giờ lưu plaintext.',
      role: "Vai trò: 'superadmin' | 'admin' | 'staff' | 'teacher'.",
      name: 'Tên hiển thị.',
      center_id: 'Trung tâm trực thuộc; NULL = superadmin (thấy toàn hệ thống). RESTRICT khi xóa center.',
      teacher_id: 'Liên kết tới hồ sơ giáo viên (nếu role=teacher). SET NULL khi xóa giáo viên.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  centers: {
    description: 'Trung tâm (tenant) trong mô hình SaaS multi-tenant.',
    columns: {
      id: 'Khóa chính.',
      name: 'Tên trung tâm.',
      subdomain: 'Subdomain duy nhất (vd: demo).',
      phone: 'Số điện thoại liên hệ.',
      address: 'Địa chỉ.',
      plan: "Gói cước: 'basic' (199k) | 'standard' (399k) | 'premium' (799k).",
      plan_expires_at: 'Ngày hết hạn gói (ISO date).',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  center_settings: {
    description: 'Cấu hình key-value theo từng trung tâm (ghi đè settings toàn cục).',
    columns: {
      center_id: 'Trung tâm sở hữu. CASCADE khi xóa center.',
      key: 'Khóa cấu hình.',
      value: 'Giá trị (chuỗi; JSON nếu phức tạp).',
    },
  },
  teachers: {
    description: 'Hồ sơ giáo viên của trung tâm.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm trực thuộc. RESTRICT khi xóa center.',
      name: 'Họ tên.',
      phone: 'Số điện thoại.',
      email: 'Email.',
      subject: 'Môn dạy chính.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  students: {
    description: 'Hồ sơ học viên — thực thể trung tâm của nghiệp vụ.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm trực thuộc. RESTRICT khi xóa center.',
      code: 'Mã học viên, duy nhất (vd: HV001).',
      name: 'Họ tên.',
      phone: 'Số điện thoại.',
      email: 'Email.',
      dob: 'Ngày sinh (ISO date).',
      address: 'Địa chỉ.',
      status: "Trạng thái: 'studying' | 'paused' | 'quit'.",
      note: 'Ghi chú nội bộ.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  classes: {
    description: 'Lớp học: nhóm học viên + giáo viên + lịch học + học phí.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm sở hữu. RESTRICT khi xóa center.',
      name: 'Tên lớp.',
      teacher_id: 'Giáo viên phụ trách. SET NULL khi xóa giáo viên.',
      room_id: 'Phòng học. SET NULL khi xóa phòng.',
      schedule: 'Lịch học dạng JSON [{day, start, end}].',
      start_date: 'Ngày khai giảng (ISO date).',
      end_date: 'Ngày kết thúc (ISO date).',
      tuition_fee: 'Học phí/khóa (VND, >= 0).',
      max_students: 'Sĩ số tối đa (> 0).',
      status: "Trạng thái: 'active' | 'inactive'.",
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  enrollments: {
    description: 'Ghi danh: học viên tham gia lớp (quan hệ nhiều-nhiều + trạng thái).',
    columns: {
      id: 'Khóa chính.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      class_id: 'Lớp học. CASCADE khi xóa lớp.',
      enrolled_at: 'Thời điểm ghi danh (UTC).',
      status: "Trạng thái: 'active' | 'inactive'.",
    },
  },
  sessions: {
    description: 'Buổi học cụ thể của lớp (sinh tự động từ lịch).',
    columns: {
      id: 'Khóa chính.',
      class_id: 'Lớp học. CASCADE khi xóa lớp.',
      date: 'Ngày học (ISO date). Duy nhất theo từng lớp.',
      topic: 'Chủ đề buổi học.',
      checkin_code: 'Mã điểm danh 6 số cho giáo viên.',
      checkin_date: 'Ngày mã có hiệu lực.',
    },
  },
  attendance: {
    description: 'Điểm danh từng học viên trong từng buổi học.',
    columns: {
      id: 'Khóa chính.',
      session_id: 'Buổi học. CASCADE khi xóa buổi.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      status: "Trạng thái: 'present' | 'absent' | 'late'.",
      note: 'Ghi chú.',
    },
  },
  invoices: {
    description: 'Hóa đơn học phí của học viên.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm sở hữu. RESTRICT khi xóa center.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      class_id: 'Lớp áp dụng (tùy chọn). SET NULL khi xóa lớp.',
      amount: 'Tổng tiền hóa đơn (VND, >= 0).',
      due_date: 'Hạn thanh toán (ISO date).',
      status: "Trạng thái: 'unpaid' | 'partial' | 'paid' — tự động tính lại bởi recalcInvoiceStatus.",
      note: 'Ghi chú.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  payments: {
    description: 'Khoản thu tiền cho hóa đơn (kể cả khoản chờ duyệt của phụ huynh).',
    columns: {
      id: 'Khóa chính.',
      invoice_id: 'Hóa đơn. CASCADE khi xóa hóa đơn.',
      amount: 'Số tiền thu (VND, > 0).',
      paid_at: 'Thời điểm thu (UTC).',
      method: 'Hình thức thu (tự do: Tiền mặt, bank_transfer, vnpay...).',
      note: 'Ghi chú.',
      status: "Trạng thái: 'pending' (chờ duyệt) | 'confirmed' | 'rejected'. Chỉ 'confirmed' được tính công nợ.",
    },
  },
  payment_txns: {
    description: 'Giao dịch thanh toán online (VNPay/VietQR) — chống trùng bằng ref.',
    columns: {
      ref: 'Mã tham chiếu duy nhất của cổng thanh toán.',
      invoice_id: 'Hóa đơn liên quan. CASCADE khi xóa hóa đơn.',
      amount: 'Số tiền (VND, > 0).',
      status: "Trạng thái: 'pending' | 'confirmed' | 'failed' | 'rejected'.",
      created_at: 'Thời điểm tạo (UTC).',
    },
  },
  settings: {
    description: 'Cấu hình key-value toàn cục (legacy — mới dùng center_settings).',
    columns: {
      key: 'Khóa cấu hình (PK).',
      value: 'Giá trị.',
    },
  },
  reminders: {
    description: 'Lịch sử nhắc học phí qua Zalo (ZNS).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm gửi. RESTRICT khi xóa center.',
      invoice_id: 'Hóa đơn liên quan (tùy chọn). SET NULL khi xóa hóa đơn.',
      student_id: 'Học viên (tùy chọn). SET NULL khi xóa học viên.',
      phone: 'SĐT người nhận.',
      kind: "Loại nhắc: 'overdue' | 'upcoming' | 'receipt'.",
      status: "Kết quả gửi: 'sent' | 'failed' | 'demo' (chế độ demo/log).",
      message: 'Nội dung đã gửi.',
      response: 'Phản hồi từ Zalo API.',
      created_at: 'Thời điểm gửi (UTC).',
    },
  },
  parents: {
    description: 'Tài khoản phụ huynh (đăng nhập bằng SĐT + mật khẩu riêng).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm trực thuộc. RESTRICT khi xóa center.',
      phone: 'SĐT đăng nhập. Duy nhất trong từng center.',
      password_hash: 'Mật khẩu đã băm bcrypt.',
      name: 'Tên phụ huynh.',
      referral_code: 'Mã giới thiệu duy nhất của phụ huynh.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  parent_students: {
    description: 'Liên kết phụ huynh — con (một phụ huynh nhiều con, một con nhiều phụ huynh).',
    columns: {
      parent_id: 'Phụ huynh. CASCADE khi xóa phụ huynh.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      created_at: 'Thời điểm liên kết (UTC).',
    },
  },
  leave_requests: {
    description: 'Đơn xin nghỉ phép của học viên (phụ huynh gửi, trung tâm duyệt).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      student_id: 'Học viên xin nghỉ. CASCADE khi xóa học viên.',
      class_id: 'Lớp liên quan (tùy chọn). SET NULL khi xóa lớp.',
      from_date: 'Nghỉ từ ngày (ISO date).',
      to_date: 'Nghỉ đến ngày (ISO date) — phải >= from_date.',
      reason: 'Lý do.',
      status: "Trạng thái: 'pending' | 'approved' | 'rejected'.",
      decided_by: 'Người duyệt (users.id). SET NULL khi xóa user.',
      decided_at: 'Thời điểm duyệt (UTC).',
      created_at: 'Thời điểm gửi đơn (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  grades: {
    description: 'Sổ điểm điện tử: điểm từng đầu điểm của học viên.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      class_id: 'Lớp (tùy chọn). SET NULL khi xóa lớp.',
      title: 'Tên đầu điểm (vd: Kiểm tra giữa kỳ).',
      score: 'Điểm đạt được (>= 0, <= max_score).',
      max_score: 'Thang điểm (> 0, mặc định 10).',
      comment: 'Nhận xét.',
      created_by: 'Người nhập điểm (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm nhập (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  homework: {
    description: 'Bài tập / quiz giao cho lớp (học từ Google Classroom: draft/schedule/rubric).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      class_id: 'Lớp được giao. CASCADE khi xóa lớp.',
      title: 'Tiêu đề.',
      content: 'Nội dung (hỗ trợ rich text).',
      due_date: 'Hạn nộp (ISO datetime).',
      status: "Trạng thái: 'draft' | 'scheduled' (hẹn giờ) | 'published'.",
      publish_at: 'Thời điểm tự đăng khi status=scheduled.',
      max_score: 'Điểm tối đa (NULL = không chấm điểm).',
      close_date: 'Hạn chót cứng — qua ngày này khóa nộp bài.',
      kind: "Loại: 'homework' (tự luận/nộp file) | 'quiz' (trắc nghiệm tự chấm).",
      rubric_id: 'Rubric chấm điểm (tùy chọn). SET NULL khi xóa rubric.',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  homework_completions: {
    description: 'Đánh dấu hoàn thành bài tập theo từng học viên.',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      completed_at: 'Thời điểm hoàn thành (UTC).',
      completed_by: "Người đánh dấu: 'parent' | 'teacher' | 'student'.",
    },
  },
  homework_attachments: {
    description: 'Tài liệu đính kèm của bài tập (file/link/audio/video).',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      name: 'Tên hiển thị.',
      url: 'Đường dẫn file hoặc link.',
      kind: "Loại: 'link' | 'file' | 'audio' | 'video'.",
    },
  },
  homework_targets: {
    description: 'Giao bài riêng cho từng học viên (Classroom: individual students). Rỗng = cả lớp.',
    columns: {
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên được giao riêng. CASCADE khi xóa học viên.',
      due_date: 'Hạn riêng cho học viên này (Canvas: differentiated deadlines).',
    },
  },
  rubrics: {
    description: 'Bộ tiêu chí chấm điểm tái sử dụng.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên rubric.',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (UTC).',
    },
  },
  rubric_criteria: {
    description: 'Từng tiêu chí trong rubric.',
    columns: {
      id: 'Khóa chính.',
      rubric_id: 'Rubric chứa. CASCADE khi xóa rubric.',
      name: 'Tên tiêu chí.',
      max_score: 'Điểm tối đa của tiêu chí (> 0).',
      position: 'Thứ tự hiển thị (>= 0).',
    },
  },
  quiz_questions: {
    description: 'Câu hỏi trắc nghiệm của quiz.',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Quiz chứa (homework.kind=quiz). CASCADE khi xóa bài.',
      position: 'Thứ tự câu hỏi (>= 0).',
      question: 'Nội dung câu hỏi.',
      points: 'Số điểm của câu (> 0).',
    },
  },
  quiz_options: {
    description: 'Các đáp án của một câu hỏi trắc nghiệm.',
    columns: {
      id: 'Khóa chính.',
      question_id: 'Câu hỏi. CASCADE khi xóa câu hỏi.',
      position: 'Thứ tự đáp án (>= 0).',
      text: 'Nội dung đáp án.',
      is_correct: '1 = đáp án đúng, 0 = sai.',
    },
  },
  quiz_attempts: {
    description: 'Lượt làm quiz của học viên.',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Quiz. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      score: 'Điểm đạt được (>= 0).',
      max_score: 'Tổng điểm của quiz (>= 0).',
      submitted_at: 'Thời điểm nộp (UTC).',
    },
  },
  quiz_answers: {
    description: 'Đáp án học viên đã chọn trong từng lượt làm quiz.',
    columns: {
      attempt_id: 'Lượt làm. CASCADE khi xóa lượt.',
      question_id: 'Câu hỏi. CASCADE khi xóa câu hỏi.',
      option_id: 'Đáp án đã chọn (NULL = bỏ trống). SET NULL khi xóa đáp án.',
    },
  },
  homework_scores: {
    description: 'Điểm bài tập thường (chấm tay hoặc theo rubric) theo từng học viên.',
    columns: {
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      score: 'Điểm (>= 0, NULL = chưa chấm).',
      feedback: 'Nhận xét của giáo viên.',
      graded_at: 'Thời điểm chấm (UTC).',
      graded_by: 'Người chấm (users.id). SET NULL khi xóa user.',
    },
  },
  rooms: {
    description: 'Phòng học của trung tâm (chặn trùng lịch khi xếp lớp).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên phòng.',
      capacity: 'Sức chứa (> 0).',
    },
  },
  salary_rules: {
    description: 'Quy tắc lương theo buổi của từng giáo viên.',
    columns: {
      teacher_id: 'Giáo viên (PK). CASCADE khi xóa giáo viên.',
      per_session_amount: 'Tiền công mỗi buổi dạy (VND, >= 0).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  teacher_checkins: {
    description: 'Giáo viên điểm danh buổi dạy bằng mã 6 số.',
    columns: {
      id: 'Khóa chính.',
      session_id: 'Buổi dạy. CASCADE khi xóa buổi.',
      teacher_id: 'Giáo viên. CASCADE khi xóa giáo viên.',
      created_at: 'Thời điểm điểm danh (UTC).',
    },
  },
  trial_registrations: {
    description: 'Đăng ký học thử từ landing page.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên người đăng ký.',
      phone: 'SĐT.',
      class_id: 'Lớp muốn học thử (tùy chọn). SET NULL khi xóa lớp.',
      desired_date: 'Ngày mong muốn (ISO date).',
      note: 'Ghi chú.',
      referral_code: 'Mã giới thiệu được dùng (nếu có).',
      status: "Trạng thái: 'new' | 'contacted' | 'converted'.",
      created_at: 'Thời điểm đăng ký (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  leads: {
    description: 'Lead mini-CRM: khách hàng tiềm năng và pipeline chăm sóc.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên lead.',
      phone: 'SĐT.',
      source: 'Nguồn (vd: landing, facebook, referral).',
      status: "Trạng thái pipeline: 'new' | 'contacted' | 'trial' | 'enrolled' | 'lost'.",
      note: 'Ghi chú chăm sóc.',
      created_at: 'Thời điểm tạo (UTC).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  referrals: {
    description: 'Lịch sử giới thiệu bạn bè của phụ huynh (đổi credit học phí).',
    columns: {
      id: 'Khóa chính.',
      referrer_parent_id: 'Phụ huynh giới thiệu. CASCADE khi xóa phụ huynh.',
      referred_phone: 'SĐT người được giới thiệu.',
      referred_student_id: 'Học viên đã đăng ký từ giới thiệu (tùy chọn). SET NULL khi xóa học viên.',
      status: "Trạng thái: 'pending' | 'rewarded'.",
      created_at: 'Thời điểm tạo (UTC).',
    },
  },
  credits: {
    description: 'Credit học phí của phụ huynh (từ giới thiệu / khuyến mãi), trừ dần khi đóng tiền.',
    columns: {
      id: 'Khóa chính.',
      parent_id: 'Phụ huynh sở hữu. CASCADE khi xóa phụ huynh.',
      amount: 'Tổng credit được cấp (VND, > 0).',
      reason: 'Lý do cấp.',
      used_amount: 'Đã sử dụng (0 <= used_amount <= amount).',
      created_at: 'Thời điểm cấp (UTC).',
    },
  },
  reviews: {
    description: 'Đánh giá của phụ huynh về trung tâm (duyệt mới hiển thị công khai).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm được đánh giá. RESTRICT khi xóa center.',
      parent_id: 'Phụ huynh đánh giá (tùy chọn). SET NULL khi xóa phụ huynh.',
      rating: 'Số sao (1–5).',
      comment: 'Nội dung đánh giá.',
      status: "Trạng thái: 'pending' | 'approved' | 'rejected'.",
      created_at: 'Thời điểm đánh giá (UTC).',
    },
  },
  audit_logs: {
    description:
      'Nhật ký kiểm toán append-only: mọi thao tác quan trọng của người dùng. ' +
      'CỐ TÌNH không đặt khóa ngoại để log bất tử kể cả khi bản ghi gốc bị xóa.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm nơi xảy ra thao tác (có thể NULL).',
      actor_id: 'ID người thực hiện (không FK — giữ log khi user bị xóa).',
      actor_name: 'Tên người thực hiện (denormalize để log tự đủ nghĩa).',
      actor_role: 'Vai trò lúc thực hiện.',
      action: 'Hành động (vd: student.delete, payment.approve).',
      entity: 'Loại đối tượng (vd: student, invoice).',
      entity_id: 'ID đối tượng (không FK — giữ log khi đối tượng bị xóa).',
      summary: 'Mô tả ngắn gọn cho người đọc.',
      meta: 'Chi tiết thêm dạng JSON.',
      ip: 'IP của người thực hiện.',
      created_at: 'Thời điểm ghi log (UTC).',
    },
  },
  question_bank: {
    description: 'Ngân hàng câu hỏi trắc nghiệm tái sử dụng (học từ Canvas/Moodle).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      tag: 'Nhãn/chủ đề để tìm nhanh.',
      question: 'Nội dung câu hỏi.',
      points: 'Số điểm mặc định khi đưa vào quiz (> 0).',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (UTC).',
    },
  },
  question_bank_options: {
    description: 'Các đáp án của câu hỏi trong ngân hàng.',
    columns: {
      id: 'Khóa chính.',
      question_id: 'Câu hỏi. CASCADE khi xóa câu hỏi.',
      position: 'Thứ tự đáp án (>= 0).',
      text: 'Nội dung đáp án.',
      is_correct: '1 = đáp án đúng, 0 = sai.',
    },
  },
  homework_submissions: {
    description: 'Bài nộp của học viên: ảnh/file bài làm + ghi chú (khóa nộp khi quá close_date).',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên nộp. CASCADE khi xóa học viên.',
      file_url: 'Đường dẫn file đã tải lên (tối đa 10MB).',
      file_name: 'Tên file gốc.',
      note: 'Ghi chú kèm theo.',
      submitted_at: 'Thời điểm nộp (UTC).',
    },
  },
};
/* -------------------------------------------------------------------------------------
 * createSchema — tạo toàn bộ bảng (idempotent — IF NOT EXISTS).
 * Đây là "lần cài mới": nhận đầy đủ FK + CHECK + trigger + view.
 * DB cũ nâng cấp qua versionedMigrations (chỉ backfill được cột mới —
 * SQLite không ALTER để thêm FK/CHECK vào bảng đã tồn tại).
 * ----------------------------------------------------------------------------------- */
export function createSchema(db: Db): void {
  db.exec(`
-- ================= BẢNG NỀN TẢNG =================
CREATE TABLE IF NOT EXISTS centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  plan TEXT NOT NULL DEFAULT 'standard'
    CONSTRAINT chk_centers_plan CHECK (plan IN ('basic', 'standard', 'premium')),
  plan_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff'
    CONSTRAINT chk_users_role CHECK (role IN ('superadmin', 'admin', 'staff', 'teacher')),
  name TEXT NOT NULL,
  center_id INTEGER
    CONSTRAINT fk_users_center REFERENCES centers(id) ON DELETE RESTRICT,
  teacher_id INTEGER
    CONSTRAINT fk_users_teacher REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS center_settings (
  center_id INTEGER NOT NULL
    CONSTRAINT fk_center_settings_center REFERENCES centers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (center_id, key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ================= NHÂN SỰ & ĐÀO TẠO =================
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_teachers_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  subject TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_students_center REFERENCES centers(id) ON DELETE RESTRICT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  dob TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'studying'
    CONSTRAINT chk_students_status CHECK (status IN ('studying', 'paused', 'quit')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_rooms_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30
    CONSTRAINT chk_rooms_capacity CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_classes_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  teacher_id INTEGER
    CONSTRAINT fk_classes_teacher REFERENCES teachers(id) ON DELETE SET NULL,
  room_id INTEGER
    CONSTRAINT fk_classes_room REFERENCES rooms(id) ON DELETE SET NULL,
  schedule TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  end_date TEXT,
  tuition_fee REAL NOT NULL DEFAULT 0
    CONSTRAINT chk_classes_fee CHECK (tuition_fee >= 0),
  max_students INTEGER NOT NULL DEFAULT 30
    CONSTRAINT chk_classes_max CHECK (max_students > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT chk_classes_status CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_enrollments_student REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL
    CONSTRAINT fk_enrollments_class REFERENCES classes(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT chk_enrollments_status CHECK (status IN ('active', 'inactive')),
  UNIQUE(student_id, class_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL
    CONSTRAINT fk_sessions_class REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  topic TEXT,
  checkin_code TEXT,
  checkin_date TEXT,
  UNIQUE(class_id, date)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL
    CONSTRAINT fk_attendance_session REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_attendance_student REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'present'
    CONSTRAINT chk_attendance_status CHECK (status IN ('present', 'absent', 'late')),
  note TEXT,
  UNIQUE(session_id, student_id)
);

CREATE TABLE IF NOT EXISTS teacher_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL
    CONSTRAINT fk_checkins_session REFERENCES sessions(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL
    CONSTRAINT fk_checkins_teacher REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS salary_rules (
  teacher_id INTEGER PRIMARY KEY
    CONSTRAINT fk_salary_teacher REFERENCES teachers(id) ON DELETE CASCADE,
  per_session_amount REAL NOT NULL DEFAULT 0
    CONSTRAINT chk_salary_amount CHECK (per_session_amount >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================= TÀI CHÍNH =================
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_invoices_center REFERENCES centers(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_invoices_student REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER
    CONSTRAINT fk_invoices_class REFERENCES classes(id) ON DELETE SET NULL,
  amount REAL NOT NULL
    CONSTRAINT chk_invoices_amount CHECK (amount >= 0),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CONSTRAINT chk_invoices_status CHECK (status IN ('unpaid', 'partial', 'paid')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL
    CONSTRAINT fk_payments_invoice REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  method TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CONSTRAINT chk_payments_status CHECK (status IN ('pending', 'confirmed', 'rejected'))
);

CREATE TABLE IF NOT EXISTS payment_txns (
  ref TEXT PRIMARY KEY,
  invoice_id INTEGER NOT NULL
    CONSTRAINT fk_txns_invoice REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL
    CONSTRAINT chk_txns_amount CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_txns_status CHECK (status IN ('pending', 'confirmed', 'failed', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL
    CONSTRAINT fk_credits_parent REFERENCES parents(id) ON DELETE CASCADE,
  amount REAL NOT NULL
    CONSTRAINT chk_credits_amount CHECK (amount > 0),
  reason TEXT,
  used_amount REAL NOT NULL DEFAULT 0
    CONSTRAINT chk_credits_used CHECK (used_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT chk_credits_used_lte CHECK (used_amount <= amount)
);

-- ================= CỔNG PHỤ HUYNH =================
CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_parents_center REFERENCES centers(id) ON DELETE RESTRICT,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  referral_code TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(center_id, phone)
);

CREATE TABLE IF NOT EXISTS parent_students (
  parent_id INTEGER NOT NULL
    CONSTRAINT fk_ps_parent REFERENCES parents(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_ps_student REFERENCES students(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, student_id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_leaves_center REFERENCES centers(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_leaves_student REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER
    CONSTRAINT fk_leaves_class REFERENCES classes(id) ON DELETE SET NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_leaves_status CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by INTEGER
    CONSTRAINT fk_leaves_decider REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT chk_leaves_dates CHECK (to_date >= from_date)
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_grades_center REFERENCES centers(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_grades_student REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER
    CONSTRAINT fk_grades_class REFERENCES classes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  score REAL NOT NULL
    CONSTRAINT chk_grades_score CHECK (score >= 0),
  max_score REAL NOT NULL DEFAULT 10
    CONSTRAINT chk_grades_max CHECK (max_score > 0),
  comment TEXT,
  created_by INTEGER
    CONSTRAINT fk_grades_creator REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT chk_grades_score_lte CHECK (score <= max_score)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_reviews_center REFERENCES centers(id) ON DELETE RESTRICT,
  parent_id INTEGER
    CONSTRAINT fk_reviews_parent REFERENCES parents(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL
    CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_reviews_status CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_parent_id INTEGER NOT NULL
    CONSTRAINT fk_referrals_referrer REFERENCES parents(id) ON DELETE CASCADE,
  referred_phone TEXT,
  referred_student_id INTEGER
    CONSTRAINT fk_referrals_student REFERENCES students(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_referrals_status CHECK (status IN ('pending', 'rewarded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================= BÀI TẬP / QUIZ =================
CREATE TABLE IF NOT EXISTS rubrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_rubrics_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_by INTEGER
    CONSTRAINT fk_rubrics_creator REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rubric_id INTEGER NOT NULL
    CONSTRAINT fk_criteria_rubric REFERENCES rubrics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_score REAL NOT NULL DEFAULT 10
    CONSTRAINT chk_criteria_max CHECK (max_score > 0),
  position INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_criteria_pos CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_homework_center REFERENCES centers(id) ON DELETE RESTRICT,
  class_id INTEGER NOT NULL
    CONSTRAINT fk_homework_class REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'published'
    CONSTRAINT chk_homework_status CHECK (status IN ('draft', 'scheduled', 'published')),
  publish_at TEXT,
  max_score REAL
    CONSTRAINT chk_homework_max CHECK (max_score IS NULL OR max_score > 0),
  close_date TEXT,
  kind TEXT NOT NULL DEFAULT 'homework'
    CONSTRAINT chk_homework_kind CHECK (kind IN ('homework', 'quiz')),
  rubric_id INTEGER
    CONSTRAINT fk_homework_rubric REFERENCES rubrics(id) ON DELETE SET NULL,
  created_by INTEGER
    CONSTRAINT fk_homework_creator REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homework_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_attachments_hw REFERENCES homework(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link'
    CONSTRAINT chk_attachments_kind CHECK (kind IN ('link', 'file', 'audio', 'video'))
);

CREATE TABLE IF NOT EXISTS homework_targets (
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_targets_hw REFERENCES homework(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_targets_student REFERENCES students(id) ON DELETE CASCADE,
  due_date TEXT,
  UNIQUE(homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS homework_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_completions_hw REFERENCES homework(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_completions_student REFERENCES students(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_by TEXT NOT NULL DEFAULT 'parent'
    CONSTRAINT chk_completions_by CHECK (completed_by IN ('parent', 'teacher', 'student')),
  UNIQUE(homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS homework_scores (
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_scores_hw REFERENCES homework(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_scores_student REFERENCES students(id) ON DELETE CASCADE,
  score REAL
    CONSTRAINT chk_scores_value CHECK (score IS NULL OR score >= 0),
  feedback TEXT,
  graded_at TEXT NOT NULL DEFAULT (datetime('now')),
  graded_by INTEGER
    CONSTRAINT fk_scores_grader REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_submissions_hw REFERENCES homework(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_submissions_student REFERENCES students(id) ON DELETE CASCADE,
  file_url TEXT,
  file_name TEXT,
  note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_qq_hw REFERENCES homework(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_qq_pos CHECK (position >= 0),
  question TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1
    CONSTRAINT chk_qq_points CHECK (points > 0)
);

CREATE TABLE IF NOT EXISTS quiz_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL
    CONSTRAINT fk_qo_question REFERENCES quiz_questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_qo_pos CHECK (position >= 0),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_qo_correct CHECK (is_correct IN (0, 1))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL
    CONSTRAINT fk_qa_hw REFERENCES homework(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL
    CONSTRAINT fk_qa_student REFERENCES students(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0
    CONSTRAINT chk_qa_score CHECK (score >= 0),
  max_score REAL NOT NULL DEFAULT 0
    CONSTRAINT chk_qa_max CHECK (max_score >= 0),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  attempt_id INTEGER NOT NULL
    CONSTRAINT fk_qans_attempt REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL
    CONSTRAINT fk_qans_question REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_id INTEGER
    CONSTRAINT fk_qans_option REFERENCES quiz_options(id) ON DELETE SET NULL,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_qbank_center REFERENCES centers(id) ON DELETE RESTRICT,
  tag TEXT,
  question TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1
    CONSTRAINT chk_qbank_points CHECK (points > 0),
  created_by INTEGER
    CONSTRAINT fk_qbank_creator REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS question_bank_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL
    CONSTRAINT fk_qbo_question REFERENCES question_bank(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_qbo_pos CHECK (position >= 0),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
    CONSTRAINT chk_qbo_correct CHECK (is_correct IN (0, 1))
);

-- ================= TUYỂN SINH & TĂNG TRƯỞNG =================
CREATE TABLE IF NOT EXISTS trial_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_trials_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  class_id INTEGER
    CONSTRAINT fk_trials_class REFERENCES classes(id) ON DELETE SET NULL,
  desired_date TEXT,
  note TEXT,
  referral_code TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CONSTRAINT chk_trials_status CHECK (status IN ('new', 'contacted', 'converted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_leads_center REFERENCES centers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CONSTRAINT chk_leads_status CHECK (status IN ('new', 'contacted', 'trial', 'enrolled', 'lost')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================= VẬN HÀNH =================
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER
    CONSTRAINT fk_reminders_center REFERENCES centers(id) ON DELETE RESTRICT,
  invoice_id INTEGER
    CONSTRAINT fk_reminders_invoice REFERENCES invoices(id) ON DELETE SET NULL,
  student_id INTEGER
    CONSTRAINT fk_reminders_student REFERENCES students(id) ON DELETE SET NULL,
  phone TEXT,
  kind TEXT NOT NULL DEFAULT 'overdue'
    CONSTRAINT chk_reminders_kind CHECK (kind IN ('overdue', 'upcoming', 'receipt')),
  status TEXT NOT NULL DEFAULT 'sent'
    CONSTRAINT chk_reminders_status CHECK (status IN ('sent', 'failed', 'demo')),
  message TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
}
/* -------------------------------------------------------------------------------------
 * createTriggers — trigger tự động chạm updated_at.
 * Idempotent (IF NOT EXISTS). recursive_triggers mặc định OFF nên không lo
 * trigger tự gọi lại chính nó.
 * ----------------------------------------------------------------------------------- */
const UPDATED_AT_TABLES = [
  'users',
  'centers',
  'teachers',
  'students',
  'classes',
  'invoices',
  'parents',
  'leave_requests',
  'grades',
  'homework',
  'trial_registrations',
  'leads',
] as const;

export function createTriggers(db: Db): void {
  const statements = UPDATED_AT_TABLES.map(
    (t) => `
CREATE TRIGGER IF NOT EXISTS trg_${t}_updated_at
AFTER UPDATE ON ${t}
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE ${t} SET updated_at = datetime('now') WHERE id = NEW.id;
END;`
  ).join('\n');
  db.exec(statements);
}

/* -------------------------------------------------------------------------------------
 * createViews — view báo cáo chỉ đọc. View không bao giờ ghi, nên an toàn tuyệt đối
 * với logic nghiệp vụ; service vẫn là nơi duy nhất quyết định số liệu "chính thức".
 * ----------------------------------------------------------------------------------- */
export function createViews(db: Db): void {
  db.exec(`
-- Công nợ từng hóa đơn: tổng thu đã duyệt (confirmed) và số còn lại phải thu.
CREATE VIEW IF NOT EXISTS v_invoice_balance AS
SELECT
  i.id AS invoice_id,
  i.center_id,
  i.student_id,
  i.class_id,
  i.amount AS invoice_amount,
  i.status,
  i.due_date,
  COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.invoice_id = i.id AND p.status = 'confirmed'
  ), 0) AS paid_confirmed,
  i.amount - COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.invoice_id = i.id AND p.status = 'confirmed'
  ), 0) AS balance
FROM invoices i;
`);
}

/* -------------------------------------------------------------------------------------
 * validateSchema — tự kiểm tra tính toàn vẹn của schema trên DB hiện tại.
 * Ném Error với thông điệp cụ thể khi phát hiện lệch chuẩn. Dùng trong:
 *  - schema.test.ts (CI)
 *  - deep health check (tùy chọn, khi ENABLE_SCHEMA_CHECK=1)
 * ----------------------------------------------------------------------------------- */
const EXPECTED_TABLES = Object.keys(TABLE_DOCS);

/** Số FK kỳ vọng cho từng bảng (0 = cố tình không đặt, vd: audit_logs). */
const EXPECTED_FK_COUNT: Record<string, number> = {
  users: 2,
  centers: 0,
  center_settings: 1,
  settings: 0,
  teachers: 1,
  students: 1,
  rooms: 1,
  classes: 3,
  enrollments: 2,
  sessions: 1,
  attendance: 2,
  teacher_checkins: 2,
  salary_rules: 1,
  invoices: 3,
  payments: 1,
  payment_txns: 1,
  credits: 1,
  parents: 1,
  parent_students: 2,
  leave_requests: 4,
  grades: 4,
  reviews: 2,
  referrals: 2,
  rubrics: 2,
  rubric_criteria: 1,
  homework: 4,
  homework_attachments: 1,
  homework_targets: 2,
  homework_completions: 2,
  homework_scores: 3,
  homework_submissions: 2,
  quiz_questions: 1,
  quiz_options: 1,
  quiz_attempts: 2,
  quiz_answers: 3,
  question_bank: 2,
  question_bank_options: 1,
  trial_registrations: 2,
  leads: 1,
  reminders: 3,
  audit_logs: 0,
};

export function validateSchema(db: Db): void {
  const problems: string[] = [];

  // 1. Mọi bảng trong data dictionary đều phải tồn tại trong DB.
  const existing = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name)
  );
  for (const t of EXPECTED_TABLES) {
    if (!existing.has(t)) problems.push(`Thiếu bảng: ${t}`);
  }

  // 2. Không có bản ghi mồ côi vi phạm FK.
  const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
  if (violations.length > 0) {
    problems.push(`Có ${violations.length} vi phạm khóa ngoại: ${JSON.stringify(violations.slice(0, 3))}`);
  }

  // 3. Mỗi bảng có đúng số FK như thiết kế (bắt lỗi quên CONSTRAINT).
  for (const [table, expected] of Object.entries(EXPECTED_FK_COUNT)) {
    if (!existing.has(table)) continue;
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown[];
    if (fks.length !== expected) {
      problems.push(`Bảng ${table}: kỳ vọng ${expected} FK, thực tế ${fks.length}`);
    }
  }

  // 4. Mọi FK đều trỏ tới bảng/cột có thật.
  for (const table of Object.keys(EXPECTED_FK_COUNT)) {
    if (!existing.has(table)) continue;
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
      table: string;
      to: string;
    }[];
    for (const fk of fks) {
      if (!existing.has(fk.table)) {
        problems.push(`FK của ${table} trỏ tới bảng không tồn tại: ${fk.table}`);
      }
    }
  }

  // 5. Trigger updated_at đầy đủ.
  const triggers = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );
  for (const t of UPDATED_AT_TABLES) {
    if (!triggers.has(`trg_${t}_updated_at`)) problems.push(`Thiếu trigger: trg_${t}_updated_at`);
  }

  // 6. View báo cáo tồn tại.
  const views = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as { name: string }[]
    ).map((r) => r.name)
  );
  if (!views.has('v_invoice_balance')) problems.push('Thiếu view: v_invoice_balance');

  if (problems.length > 0) {
    throw new Error(`Schema không đạt chuẩn:\n- ${problems.join('\n- ')}`);
  }
}
