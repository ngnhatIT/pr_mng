/* TABLE_DOCS — data dictionary sống (quy ước: xem đầu schema.ts). B3-3: tách khỏi schema.ts. */

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
      token_version: 'D2: tăng mỗi khi đổi mật khẩu/khóa TK — access token cũ (tv khác) bị thu hồi ngay.',
      is_active: 'D2: false = tài khoản bị khóa — từ chối login và mọi request đã auth.',
      must_change_password:
        'v25 (N-5): true = mật khẩu tạm (đặt lại/admin cấp) — API trả 403 PASSWORD_CHANGE_REQUIRED tới khi đổi.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  permissions: {
    description: 'Danh mục quyền hạn nguyên tử của hệ thống (vd: students.delete).',
    columns: {
      id: 'Khóa chính.',
      code: 'Mã quyền duy nhất, dạng resource.action.',
      name: 'Tên hiển thị tiếng Việt.',
      description: 'Mô tả chi tiết quyền.',
      module: 'Nhóm module (students, invoices, system...).',
      created_at: 'Thời điểm tạo.',
    },
  },
  roles: {
    description: 'Vai trò: nhóm quyền. System role cố định, custom role do admin tạo.',
    columns: {
      id: 'Khóa chính.',
      code: 'Mã role duy nhất.',
      name: 'Tên hiển thị.',
      description: 'Mô tả vai trò.',
      center_id: 'NULL = system role dùng chung; có giá trị = role riêng trung tâm.',
      is_system: 'TRUE = role hệ thống, không được xóa/sửa code.',
      created_at: 'Thời điểm tạo.',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  role_permissions: {
    description: 'Gán quyền cho role, kèm scope (own/center/all).',
    columns: {
      role_id: 'Role được gán. CASCADE khi xóa role.',
      permission_id: 'Quyền được gán. CASCADE khi xóa permission.',
      scope: "Phạm vi: 'own' (dữ liệu của mình), 'center' (trung tâm mình), 'all' (toàn hệ thống).",
    },
  },
  user_roles: {
    description: 'Gán thêm custom roles cho user (ngoài role chính).',
    columns: {
      user_id: 'User được gán. CASCADE khi xóa user.',
      role_id: 'Role được gán. CASCADE khi xóa role.',
      assigned_at: 'Thời điểm gán.',
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
      created_at: 'Thời điểm tạo (giờ VN).',
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
      created_at: 'Thời điểm tạo (giờ VN).',
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
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
      version: 'Phiên bản optimistic locking — tăng tự động mỗi lần UPDATE.',
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
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
      version: 'Phiên bản optimistic locking — tăng tự động mỗi lần UPDATE.',
    },
  },
  enrollments: {
    description: 'Ghi danh: học viên tham gia lớp (quan hệ nhiều-nhiều + trạng thái).',
    columns: {
      id: 'Khóa chính.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      class_id: 'Lớp học. CASCADE khi xóa lớp.',
      enrolled_at: 'Thời điểm ghi danh (giờ VN).',
      status: "Trạng thái: 'active' | 'inactive'.",
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      teacher_id:
        'v22: giáo viên thực dạy buổi này (chốt lúc sinh buổi/điểm danh/check-in) — lương tính theo cột này. SET NULL khi xóa GV.',
      status: "v22: 'scheduled' | 'cancelled' (hủy mềm — sinh lịch lại sẽ bỏ qua ngày đã hủy).",
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
      version: 'Phiên bản optimistic locking — tăng tự động mỗi lần UPDATE.',
    },
  },
  payments: {
    description: 'Khoản thu tiền cho hóa đơn (kể cả khoản chờ duyệt của phụ huynh).',
    columns: {
      id: 'Khóa chính.',
      invoice_id: 'Hóa đơn. CASCADE khi xóa hóa đơn.',
      amount: "Số tiền thu (VND). Dương = thu, âm = hoàn tiền (chỉ khi method='refund').",
      paid_at: 'Thời điểm thu (giờ VN).',
      method:
        "Hình thức thu. Nhân viên chỉ ghi được Tiền mặt/Chuyển khoản/Quẹt thẻ/Ví điện tử/Khác; 'credit', 'refund', 'vnpay', 'bank_transfer' do hệ thống ghi.",
      note: 'Ghi chú.',
      credit_id:
        "v23: credit đã dùng cho khoản này (method='credit'). SET NULL khi xóa credit. Hoàn tiền trả lại credit qua cột này.",
      status:
        "Trạng thái: 'pending' (chờ duyệt) | 'confirmed' | 'rejected'. Chỉ 'confirmed' được tính công nợ.",
      updated_at: 'Tự động cập nhật bởi trigger.',
      version: 'Phiên bản optimistic locking — tăng tự động mỗi lần UPDATE.',
    },
  },
  payment_txns: {
    description: 'Giao dịch thanh toán online (VNPay/VietQR) — chống trùng bằng ref.',
    columns: {
      ref: 'Mã tham chiếu duy nhất của cổng thanh toán.',
      invoice_id: 'Hóa đơn liên quan. CASCADE khi xóa hóa đơn.',
      amount: 'Số tiền (VND, > 0).',
      status:
        "Trạng thái: 'pending' | 'confirmed' | 'failed' | 'rejected' | 'needs_review' (v22: tiền đã trừ nhưng không ghi nhận được — cần đối soát tay).",
      query_attempts: 'v22: số lần querydr đối soát lỗi tạm thời (mạng/bảo trì) — chỉ đánh failed sau N lần.',
      vnp_create_date:
        'v22: vnp_CreateDate thực đã gửi VNPay (yyyyMMddHHmmss) — dùng làm vnp_TransactionDate khi querydr.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Cập nhật thủ công bởi service (không có trigger tự động).',
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
      dedup_key: "Khóa chống gửi trùng 'invoiceId:kind:ngày VN' (unique khi status sending/sent/demo).",
      created_at: 'Thời điểm gửi (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      token_version: 'D2: tăng mỗi khi đổi mật khẩu/khóa TK — access token cũ (tv khác) bị thu hồi ngay.',
      is_active: 'D2: false = tài khoản bị khóa — từ chối login và mọi request đã auth.',
      zalo_consent: "Đồng ý nhận tin Zalo ZNS: 'granted' | 'denied' | 'unknown'.",
      must_change_password:
        'v25 (N-5): true = mật khẩu tạm do trung tâm đặt lại — phải đổi trước khi dùng API.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  parent_students: {
    description: 'Liên kết phụ huynh — con (một phụ huynh nhiều con, một con nhiều phụ huynh).',
    columns: {
      parent_id: 'Phụ huynh. CASCADE khi xóa phụ huynh.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      created_at: 'Thời điểm liên kết (giờ VN).',
      updated_at: 'Cập nhật thủ công bởi service (không có trigger tự động).',
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
      decided_at: 'Thời điểm duyệt (giờ VN).',
      created_at: 'Thời điểm gửi đơn (giờ VN).',
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
      created_at: 'Thời điểm nhập (giờ VN).',
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
      max_attempts: 'v24 (C-1): số lượt làm quiz tối đa mỗi học viên (NULL = không giới hạn).',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
      version: 'Phiên bản optimistic locking — tăng tự động mỗi lần UPDATE.',
    },
  },
  homework_completions: {
    description: 'Đánh dấu hoàn thành bài tập theo từng học viên.',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      completed_at: 'Thời điểm hoàn thành (giờ VN).',
      completed_by: "Người đánh dấu: 'parent' | 'teacher' | 'student'.",
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  homework_targets: {
    description: 'Giao bài riêng cho từng học viên (Classroom: individual students). Rỗng = cả lớp.',
    columns: {
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên được giao riêng. CASCADE khi xóa học viên.',
      due_date: 'Hạn riêng cho học viên này (Canvas: differentiated deadlines).',
      updated_at: 'Cập nhật thủ công bởi service (không có trigger tự động).',
    },
  },
  rubrics: {
    description: 'Bộ tiêu chí chấm điểm tái sử dụng.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên rubric.',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  quiz_questions: {
    description: 'Câu hỏi trắc nghiệm của quiz.',
    columns: {
      id: 'Khóa chính.',
      homework_id: 'Quiz chứa (homework.kind=quiz). CASCADE khi xóa bài.',
      position: 'Thứ tự câu hỏi (>= 0).',
      qtype: 'Loại câu hỏi: single/multiple/truefalse/essay (mặc định single).',
      question: 'Nội dung câu hỏi.',
      points: 'Số điểm của câu (> 0).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      submitted_at: 'Thời điểm nộp (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  quiz_answers: {
    description: 'Đáp án học viên đã chọn trong từng lượt làm quiz.',
    columns: {
      attempt_id: 'Lượt làm. CASCADE khi xóa lượt.',
      question_id: 'Câu hỏi. CASCADE khi xóa câu hỏi.',
      option_id: 'Đáp án đã chọn (NULL = bỏ trống/tự luận). SET NULL khi xóa đáp án.',
      answer_text: 'Bài làm tự luận (chỉ câu essay, chờ chấm tay).',
    },
  },
  quiz_essay_scores: {
    description: 'Điểm chấm tay từng câu tự luận của quiz theo tiêu chí rubric (YC2).',
    columns: {
      homework_id: 'Quiz. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      question_id: 'Câu essay được chấm. CASCADE khi xóa câu hỏi.',
      criterion_id: 'Tiêu chí rubric. CASCADE khi xóa tiêu chí.',
      score: 'Điểm cho tiêu chí này (0..criterion.max_score, do service validate).',
      graded_by: 'Giáo viên chấm (users.id). SET NULL khi xóa user.',
      graded_at: 'Thời điểm chấm (giờ VN).',
    },
  },
  homework_scores: {
    description: 'Điểm bài tập thường (chấm tay hoặc theo rubric) theo từng học viên.',
    columns: {
      homework_id: 'Bài tập. CASCADE khi xóa bài.',
      student_id: 'Học viên. CASCADE khi xóa học viên.',
      score: 'Điểm (>= 0, NULL = chưa chấm).',
      feedback: 'Nhận xét của giáo viên.',
      graded_at: 'Thời điểm chấm (giờ VN).',
      graded_by: 'Người chấm (users.id). SET NULL khi xóa user.',
      updated_at: 'Cập nhật thủ công bởi service (không có trigger tự động).',
    },
  },
  rooms: {
    description: 'Phòng học của trung tâm (chặn trùng lịch khi xếp lớp).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      name: 'Tên phòng.',
      capacity: 'Sức chứa (> 0).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  salary_rules: {
    description: 'Quy tắc lương theo buổi của từng giáo viên.',
    columns: {
      teacher_id: 'Giáo viên (PK). CASCADE khi xóa giáo viên.',
      per_session_amount:
        'Đơn giá hiện hành mỗi buổi dạy (VND, >= 0) — hiển thị; lương tính theo salary_rate_history.',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  salary_rate_history: {
    description:
      'v23: lịch sử đơn giá lương theo ngày hiệu lực — mỗi buổi dạy tính theo đơn giá hiệu lực tại ngày của buổi.',
    columns: {
      teacher_id: 'Giáo viên (PK cùng effective_from). CASCADE khi xóa giáo viên.',
      effective_from:
        "Ngày bắt đầu hiệu lực 'YYYY-MM-DD' (giờ VN). '1970-01-01' = đơn giá trước khi có lịch sử.",
      per_session_amount: 'Đơn giá mỗi buổi (VND, >= 0).',
      changed_by: 'Người đổi đơn giá. SET NULL khi xóa user.',
      created_at: 'Thời điểm ghi (giờ VN).',
    },
  },
  payroll_closures: {
    description:
      'v24 (J-A8): tháng lương đã chốt của trung tâm — chặn đổi đơn giá lùi ngày / sửa điểm danh / hủy buổi trong tháng đó.',
    columns: {
      center_id: 'Trung tâm (PK cùng month). CASCADE khi xóa trung tâm.',
      month: "Tháng đã chốt 'YYYY-MM'.",
      closed_by: 'Người chốt. SET NULL khi xóa user.',
      closed_at: 'Thời điểm chốt (giờ VN).',
      snapshot:
        'v25 (N-1): bảng lương chụp lúc chốt (JSONB [{teacher_id, teacher_name, sessions, per_session, total}]) — tháng đã chốt luôn trả số này.',
    },
  },
  teacher_checkins: {
    description: 'Giáo viên điểm danh buổi dạy bằng mã 6 số.',
    columns: {
      id: 'Khóa chính.',
      session_id: 'Buổi dạy. CASCADE khi xóa buổi.',
      teacher_id: 'Giáo viên. CASCADE khi xóa giáo viên.',
      created_at: 'Thời điểm điểm danh (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      created_at: 'Thời điểm đăng ký (giờ VN).',
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
      created_at: 'Thời điểm tạo (giờ VN).',
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
      center_id:
        'v22: trung tâm của lượt giới thiệu (trung tâm nhận đăng ký) — mọi khớp SĐT phải lọc theo cột này. CASCADE khi xóa center.',
      status: "Trạng thái: 'pending' | 'rewarded'.",
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  credits: {
    description: 'Credit học phí của phụ huynh (từ giới thiệu / khuyến mãi), trừ dần khi đóng tiền.',
    columns: {
      id: 'Khóa chính.',
      parent_id: 'Phụ huynh sở hữu. CASCADE khi xóa phụ huynh.',
      center_id: 'Trung tâm sở hữu credit (chống áp chéo). CASCADE khi xóa trung tâm.',
      amount: 'Tổng credit được cấp (VND, > 0).',
      reason: 'Lý do cấp.',
      used_amount: 'Đã sử dụng (0 <= used_amount <= amount).',
      source_invoice_id:
        'v23: hóa đơn sinh ra credit thưởng giới thiệu (thu hồi khi hóa đơn bị hoàn hết). SET NULL khi xóa hóa đơn.',
      voided_at:
        'v23: thời điểm thu hồi (giờ VN). Đã thu hồi = không còn dùng được, hoàn tiền không trả lại.',
      created_at: 'Thời điểm cấp (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      created_at: 'Thời điểm đánh giá (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  refresh_tokens: {
    description:
      'Refresh token rotation: access token chỉ sống 15 phút, refresh token (opaque, lưu hash SHA-256) sống 30 ngày. ' +
      'Mỗi lần refresh sẽ revoke token cũ và cấp cặp mới (rotation); dùng lại token đã revoke -> thu hồi cả chuỗi (chống trộm token).',
    columns: {
      id: 'Khóa chính.',
      token_hash: 'SHA-256 hex của refresh token (không lưu token thô). UNIQUE.',
      user_id: 'Chủ sở hữu staff (users.id). CASCADE khi xóa user.',
      parent_id: 'Chủ sở hữu phụ huynh (parents.id). CASCADE khi xóa parent.',
      kind: "Loại chủ sở hữu: 'staff' | 'parent' (namespace chống trùng id).",
      expires_at: 'Thời điểm hết hạn (mặc định +30 ngày).',
      created_at: 'Thời điểm cấp (giờ VN).',
      revoked_at: 'Thời điểm thu hồi (NULL = còn hiệu lực).',
      replaced_by: 'Hash của token thay thế (chuỗi rotation).',
      ip: 'IP lúc cấp token.',
      user_agent: 'User-Agent lúc cấp token.',
    },
  },
  idempotency_keys: {
    description:
      'Chống double-submit: lưu kết quả của POST theo Idempotency-Key. ' +
      'Request trùng key trả lại kết quả cũ thay vì xử lý lại.',
    columns: {
      user_key:
        "v22: actor '<id>:<role>' — PK gộp (user_key, key) để key của user này không trả response của user khác.",
      key: 'Idempotency-Key do client sinh (UUID).',
      method: 'HTTP method (vd: POST) — key dùng lại với method khác bị từ chối.',
      path: 'Đường dẫn API — key dùng lại với path khác bị từ chối.',
      body_hash: 'v22: sha256 body request — key dùng lại với body khác bị từ chối (422).',
      status: "v22: 'processing' (đã giữ chỗ, handler đang chạy) | 'done' (đã có response).",
      status_code: 'Mã trạng thái của response gốc (NULL khi processing).',
      response_body: 'Body JSON của response gốc (NULL khi processing).',
      created_at: 'Thời điểm tạo (dùng để xóa key quá TTL 24h).',
    },
  },
  uploads: {
    description:
      'v22: sổ file do nhân sự tải lên qua POST /api/v1/uploads — ghi người tải và trung tâm ' +
      'để DELETE chỉ xóa được file của mình/của trung tâm mình và chưa được tham chiếu.',
    columns: {
      filename: 'Khóa chính: tên file trong thư mục upload (hw_<uuid>.ext).',
      center_id: 'Trung tâm của người tải. CASCADE khi xóa center.',
      uploaded_by: 'User tải lên. SET NULL khi xóa user.',
      created_at: 'Thời điểm tải lên (dọn file mồ côi theo tuổi).',
    },
  },
  parent_link_failures: {
    description:
      'v22: lần liên kết con thất bại (mã HV + ngày sinh sai) — chống brute-force: khóa theo phụ huynh và theo mã HV.',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. CASCADE khi xóa center.',
      parent_id: 'Phụ huynh thử liên kết. CASCADE khi xóa phụ huynh.',
      student_code: 'Mã học viên đã thử.',
      created_at: 'Thời điểm thử (đếm trong cửa sổ thời gian).',
    },
  },
  reset_requests: {
    description:
      'Yêu cầu đặt lại mật khẩu (quên mật khẩu): user gửi yêu cầu, admin xem danh sách ' +
      'và bấm "Đặt lại mật khẩu" để sinh mật khẩu tạm (chưa có hạ tầng email/SMS nên đi qua admin).',
    columns: {
      id: 'Khóa chính.',
      identifier: 'Định danh tài khoản: username (staff) hoặc số điện thoại (parent).',
      kind: "Loại tài khoản: 'staff' | 'parent'.",
      center_id:
        'v22: trung tâm của tài khoản/Host lúc gửi — admin chỉ thấy yêu cầu của trung tâm mình. NULL = không xác định (chỉ superadmin thấy).',
      status: "Trạng thái: 'pending' (chờ admin) | 'processed' (đã cấp mật khẩu tạm).",
      created_at: 'Thời điểm gửi yêu cầu (giờ VN).',
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
      created_at: 'Thời điểm ghi log (giờ VN).',
    },
  },
  question_bank: {
    description: 'Ngân hàng câu hỏi trắc nghiệm tái sử dụng (học từ Canvas/Moodle).',
    columns: {
      id: 'Khóa chính.',
      center_id: 'Trung tâm. RESTRICT khi xóa center.',
      tag: 'Nhãn/chủ đề để tìm nhanh.',
      subject: 'Môn học (vd: Toán, Tiếng Anh). NULL = chưa phân loại.',
      difficulty: 'Mức độ: easy/medium/hard (mặc định medium).',
      qtype: 'Loại câu hỏi: single/multiple/truefalse/essay (mặc định single).',
      question: 'Nội dung câu hỏi.',
      points: 'Số điểm mặc định khi đưa vào quiz (> 0).',
      created_by: 'Người tạo (users.id). SET NULL khi xóa user.',
      created_at: 'Thời điểm tạo (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      updated_at: 'Tự động cập nhật bởi trigger.',
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
      submitted_at: 'Thời điểm nộp (giờ VN).',
      updated_at: 'Tự động cập nhật bởi trigger.',
    },
  },
  payment_history: {
    description:
      'Lịch sử BẤT BIẾN của payments: mọi INSERT/UPDATE/DELETE đều được trigger ' +
      'ghi snapshot JSON. Append-only, không FK về payments để dấu vết tồn tại ' +
      'kể cả khi payment gốc bị xóa.',
    columns: {
      id: 'Khóa chính.',
      payment_id: 'ID payment tại thời điểm ghi (không FK — cố tình).',
      action: "Hành động: 'insert' | 'update' | 'delete'.",
      old_data: 'Snapshot JSON trước thay đổi (NULL khi insert).',
      new_data: 'Snapshot JSON sau thay đổi (NULL khi delete).',
      changed_by: "ID người thực hiện (từ app.user_id '<id>:<role>' do middleware gắn); NULL ngoài request.",
      changed_by_role:
        "Vai trò người thực hiện ('admin' | 'parent'...) — phân biệt users.id và parents.id trùng số.",
      changed_at: 'Thời điểm ghi (giờ VN).',
    },
  },
  invoice_history: {
    description:
      'Lịch sử BẤT BIẾN của invoices: mọi INSERT/UPDATE/DELETE đều được trigger ' +
      'ghi snapshot JSON. Append-only, không FK về invoices.',
    columns: {
      id: 'Khóa chính.',
      invoice_id: 'ID invoice tại thời điểm ghi (không FK — cố tình).',
      action: "Hành động: 'insert' | 'update' | 'delete'.",
      old_data: 'Snapshot JSON trước thay đổi (NULL khi insert).',
      new_data: 'Snapshot JSON sau thay đổi (NULL khi delete).',
      changed_by: "ID người thực hiện (từ app.user_id '<id>:<role>' do middleware gắn); NULL ngoài request.",
      changed_by_role:
        "Vai trò người thực hiện ('admin' | 'parent'...) — phân biệt users.id và parents.id trùng số.",
      changed_at: 'Thời điểm ghi (giờ VN).',
    },
  },
};
