/**
 * Nội dung dữ liệu trình diễn cho `seed-showcase.ts` (tên, lớp, bài tập, đánh giá...).
 * Tách riêng khỏi logic gọi API để dễ chỉnh câu chữ. Mọi ngày tháng tính tương đối theo hôm nay.
 */

export const CENTER_NAME = 'Trung tâm Ngoại ngữ EduCenter';

export const TEACHERS = [
  { name: 'Phạm Quỳnh Anh', phone: '0903215486', email: 'quynhanh.pham@educenter.vn', subject: 'IELTS' },
  {
    name: 'Nguyễn Hoàng Minh',
    phone: '0938402175',
    email: 'minh.nguyen@educenter.vn',
    subject: 'Tiếng Anh thiếu nhi',
  },
  { name: 'Đặng Thu Trang', phone: '0976318204', email: 'trang.dang@educenter.vn', subject: 'Tiếng Hàn' },
  { name: 'Lê Quốc Bảo', phone: '0909671342', email: 'bao.le@educenter.vn', subject: 'TOEIC' },
  { name: 'Võ Ngọc Hân', phone: '0912846530', email: 'han.vo@educenter.vn', subject: 'Tiếng Trung' },
];

/** Thứ: 2..8 (8 = Chủ nhật), theo quy ước `ourDayOfWeek` của server. */
export const CLASSES: {
  name: string;
  teacher: string;
  slots: { day: number; start: string; end: string }[];
  fee: number;
  max: number;
  room?: string;
  /** Lớp đã kết thúc: bắt đầu/kết thúc trong quá khứ, trạng thái inactive. */
  finished?: boolean;
  size: number;
}[] = [
  {
    name: 'IELTS Foundation 5.0',
    room: 'Phòng B201',
    teacher: 'Phạm Quỳnh Anh',
    slots: [
      { day: 2, start: '18:00', end: '20:00' },
      { day: 4, start: '18:00', end: '20:00' },
    ],
    fee: 4800000,
    max: 16,
    size: 13,
  },
  {
    name: 'Tiếng Anh Thiếu nhi Starters',
    room: 'Phòng A102',
    teacher: 'Nguyễn Hoàng Minh',
    slots: [
      { day: 7, start: '09:00', end: '10:30' },
      { day: 8, start: '09:00', end: '10:30' },
    ],
    fee: 1800000,
    max: 15,
    size: 15,
  },
  {
    name: 'Tiếng Hàn Sơ cấp 1',
    room: 'Phòng B201',
    teacher: 'Đặng Thu Trang',
    slots: [
      { day: 3, start: '19:00', end: '21:00' },
      { day: 5, start: '19:00', end: '21:00' },
    ],
    fee: 3200000,
    max: 18,
    size: 10,
  },
  {
    name: 'TOEIC 650+',
    room: 'Phòng A101',
    teacher: 'Lê Quốc Bảo',
    slots: [
      { day: 2, start: '19:30', end: '21:00' },
      { day: 4, start: '19:30', end: '21:00' },
      { day: 6, start: '19:30', end: '21:00' },
    ],
    fee: 3900000,
    max: 20,
    size: 12,
  },
  {
    name: 'Tiếng Trung HSK 3',
    room: 'Phòng C301',
    teacher: 'Võ Ngọc Hân',
    slots: [
      { day: 3, start: '18:00', end: '20:00' },
      { day: 6, start: '18:00', end: '20:00' },
    ],
    fee: 3500000,
    max: 15,
    size: 8,
  },
  {
    name: 'Tiếng Anh Giao Tiếp B1',
    room: 'Phòng A101',
    teacher: 'Nguyễn Văn An',
    slots: [
      { day: 3, start: '18:30', end: '20:30' },
      { day: 5, start: '18:30', end: '20:30' },
    ],
    fee: 2900000,
    max: 20,
    size: 11,
  },
  {
    name: 'IELTS Writing Intensive',
    room: 'Phòng B202',
    teacher: 'Lê Văn Cường',
    slots: [{ day: 8, start: '14:00', end: '17:00' }],
    fee: 4200000,
    max: 12,
    finished: true,
    size: 9,
  },
];

/** Phòng mới (phòng A101, A102, B201 đã có từ seed gốc). */
export const NEW_ROOMS = [
  { name: 'Phòng B202', capacity: 12 },
  { name: 'Phòng C301', capacity: 18 },
];

/** Gán phòng cho 3 lớp của seed gốc (trước đó chưa có phòng). */
export const EXISTING_CLASS_ROOMS: Record<string, string> = {
  'Tiếng Anh Giao Tiếp A1': 'Phòng A101',
  'Tiếng Nhật N5': 'Phòng A102',
  'IELTS 6.5 Cấp tốc': 'Phòng B202',
};

/** Đơn giá mỗi buổi theo tên giáo viên. */
export const PAY_RATES: Record<string, number> = {
  'Nguyễn Văn An': 350000,
  'Trần Thị Bình': 380000,
  'Lê Văn Cường': 500000,
  'Phạm Quỳnh Anh': 480000,
  'Nguyễn Hoàng Minh': 300000,
  'Đặng Thu Trang': 360000,
  'Lê Quốc Bảo': 420000,
  'Võ Ngọc Hân': 380000,
};

/** Môn của lớp -> nhóm câu hỏi/bài tập. */
export const CLASS_SUBJECT: Record<string, string> = {
  'Tiếng Anh Giao Tiếp A1': 'Tiếng Anh',
  'Tiếng Nhật N5': 'Tiếng Nhật',
  'IELTS 6.5 Cấp tốc': 'IELTS',
  'IELTS Foundation 5.0': 'IELTS',
  'Tiếng Anh Thiếu nhi Starters': 'Tiếng Anh',
  'Tiếng Hàn Sơ cấp 1': 'Tiếng Hàn',
  'TOEIC 650+': 'TOEIC',
  'Tiếng Trung HSK 3': 'Tiếng Trung',
  'Tiếng Anh Giao Tiếp B1': 'Tiếng Anh',
  'IELTS Writing Intensive': 'IELTS',
};

export const STUDENT_NAMES = [
  'Nguyễn Gia Bảo',
  'Trần Khánh Linh',
  'Lê Minh Khôi',
  'Phạm Ngọc Diệp',
  'Hoàng Anh Thư',
  'Vũ Đức Huy',
  'Đặng Bảo Ngọc',
  'Bùi Quang Vinh',
  'Đỗ Thảo My',
  'Hồ Nhật Minh',
  'Ngô Phương Anh',
  'Dương Tuấn Kiệt',
  'Lý Hà Vy',
  'Mai Thanh Tùng',
  'Trịnh Bảo Châu',
  'Cao Minh Quân',
  'Phan Thùy Dương',
  'Lâm Gia Hưng',
  'Tạ Mỹ Duyên',
  'Châu Hoàng Long',
  'Nguyễn Thanh Trúc',
  'Trần Đăng Khoa',
  'Lê Ngọc Hân',
  'Phạm Hải Đăng',
  'Võ Minh Thư',
  'Huỳnh Quốc Thái',
  'Kiều Thanh Tâm',
  'Đinh Gia Huy',
  'Lương Khánh Vy',
  'Quách Tuấn Anh',
  'Nguyễn Hồng Nhung',
  'Trần Phúc Thịnh',
  'Lê Bảo Trâm',
  'Phạm Đức Mạnh',
  'Hoàng Yến Nhi',
  'Vương Minh Nhật',
  'Đoàn Thảo Nguyên',
  'Tôn Nữ Khánh An',
  'Nguyễn Văn Sơn',
  'Trương Ngọc Ánh',
  'Lê Hoàng Phúc',
  'Phùng Thu Hà',
  'Hà Minh Tâm',
  'Âu Gia Linh',
  'Tăng Quốc Việt',
  'La Bảo Anh',
  'Nguyễn Minh Triết',
  'Trần Thu Uyên',
  'Lê Đức Trọng',
  'Phạm Thanh Hằng',
  'Võ Hoàng Yến',
  'Đỗ Quang Hiếu',
  'Bùi Thị Thanh Xuân',
  'Hồ Tấn Phát',
  'Ngô Kim Ngân',
  'Lâm Chí Thanh',
  'Phan Mỹ Tiên',
  'Huỳnh Gia Khánh',
  'Đặng Minh Hiển',
  'Vũ Hải Yến',
];

export const DISTRICTS = [
  'Phường Bến Nghé, Quận 1',
  'Phường Võ Thị Sáu, Quận 3',
  'Phường 15, Quận 10',
  'Phường Tân Định, Quận 1',
  'Phường 7, Quận Phú Nhuận',
  'Phường Thảo Điền, TP. Thủ Đức',
  'Phường 12, Quận Tân Bình',
  'Phường Tân Phong, Quận 7',
  'Phường 25, Quận Bình Thạnh',
  'Phường 4, Quận 5',
];
export const STREETS = [
  'Nguyễn Thị Minh Khai',
  'Hai Bà Trưng',
  'Lý Thường Kiệt',
  'Phan Xích Long',
  'Cộng Hòa',
  'Nguyễn Văn Linh',
  'Xô Viết Nghệ Tĩnh',
  'Trần Hưng Đạo',
  'Võ Văn Tần',
  'Quốc Hương',
];

export const SESSION_TOPICS = [
  'Placement review & mục tiêu khóa',
  'Từ vựng chủ đề: Education',
  'Listening: Section 1 – form completion',
  'Grammar: thì hiện tại hoàn thành',
  'Speaking Part 1: giới thiệu bản thân',
  'Reading: True / False / Not Given',
  'Writing Task 1: biểu đồ cột',
  'Mini test giữa khóa',
  'Chữa bài mini test',
  'Pronunciation: trọng âm từ',
  'Từ vựng chủ đề: Environment',
  'Listening: Section 2 – map labelling',
];

export const LEADS: { name: string; phone: string; note: string; status: string }[] = [
  {
    name: 'Nguyễn Thị Kim Oanh',
    phone: '0907112358',
    note: 'Hỏi lớp IELTS buổi tối cho con lớp 10',
    status: 'new',
  },
  {
    name: 'Trần Văn Lộc',
    phone: '0938224466',
    note: 'Muốn học TOEIC để xét tốt nghiệp, đi làm giờ hành chính',
    status: 'new',
  },
  {
    name: 'Lê Thị Bích Ngọc',
    phone: '0976550123',
    note: 'Đăng ký qua form landing – Tiếng Hàn',
    status: 'new',
  },
  { name: 'Phạm Quang Huy', phone: '0918334509', note: '', status: 'new' },
  {
    name: 'Hoàng Minh Châu',
    phone: '0903778812',
    note: 'Đã gọi, hẹn gửi lịch khai giảng tháng sau',
    status: 'contacted',
  },
  {
    name: 'Đỗ Thanh Phong',
    phone: '0965012874',
    note: 'Quan tâm lớp thiếu nhi cho bé 7 tuổi',
    status: 'contacted',
  },
  {
    name: 'Vũ Ngọc Mai',
    phone: '0939460021',
    note: 'So sánh học phí với trung tâm khác',
    status: 'contacted',
  },
  { name: 'Bùi Thế Anh', phone: '0987123654', note: 'Học thử TOEIC thứ 6 tuần này', status: 'trial' },
  {
    name: 'Ngô Bảo Trân',
    phone: '0902445137',
    note: 'Học thử IELTS Foundation, đánh giá đầu vào 4.5',
    status: 'trial',
  },
  { name: 'Lý Hoàng Nam', phone: '0913870246', note: 'Phụ huynh muốn con học cuối tuần', status: 'trial' },
  { name: 'Trương Mỹ Linh', phone: '0948305719', note: 'Chuyển nhà ra Hà Nội', status: 'lost' },
  { name: 'Đặng Văn Toàn', phone: '0971628405', note: 'Chọn học online', status: 'lost' },
];

export const TRIALS: { name: string; phone: string; course: string; note: string }[] = [
  { name: 'Bùi Thế Anh', phone: '0987123654', course: 'TOEIC 650+', note: 'Đi làm, chỉ học được buổi tối' },
  {
    name: 'Ngô Bảo Trân',
    phone: '0902445137',
    course: 'IELTS Foundation 5.0',
    note: 'Mục tiêu 6.0 trong 8 tháng',
  },
  {
    name: 'Lý Hoàng Nam',
    phone: '0913870246',
    course: 'Tiếng Anh Thiếu nhi Starters',
    note: 'Bé 8 tuổi, đã học Cambridge Pre-A1',
  },
  { name: 'Phan Hữu Nghĩa', phone: '0935507812', course: 'Tiếng Trung HSK 3', note: '' },
];

export const BANK_QUESTIONS: {
  subject: string;
  tag: string;
  difficulty: 'easy' | 'medium' | 'hard';
  qtype: 'single' | 'multiple' | 'truefalse' | 'essay';
  question: string;
  points: number;
  options: { text: string; is_correct: boolean }[];
}[] = [
  {
    subject: 'Tiếng Anh',
    tag: 'Grammar',
    difficulty: 'easy',
    qtype: 'single',
    question: 'She ___ to school by bus every day.',
    points: 1,
    options: [
      { text: 'go', is_correct: false },
      { text: 'goes', is_correct: true },
      { text: 'going', is_correct: false },
      { text: 'gone', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Anh',
    tag: 'Grammar',
    difficulty: 'medium',
    qtype: 'single',
    question: 'By the time we arrived, the film ___.',
    points: 1,
    options: [
      { text: 'already started', is_correct: false },
      { text: 'has already started', is_correct: false },
      { text: 'had already started', is_correct: true },
      { text: 'was already start', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Anh',
    tag: 'Vocabulary',
    difficulty: 'medium',
    qtype: 'multiple',
    question: 'Which of the following words are uncountable nouns?',
    points: 2,
    options: [
      { text: 'information', is_correct: true },
      { text: 'advice', is_correct: true },
      { text: 'suggestion', is_correct: false },
      { text: 'furniture', is_correct: true },
    ],
  },
  {
    subject: 'Tiếng Anh',
    tag: 'Grammar',
    difficulty: 'hard',
    qtype: 'truefalse',
    question: '"Despite of the heavy rain, the match continued." is grammatically correct.',
    points: 1,
    options: [
      { text: 'Đúng', is_correct: false },
      { text: 'Sai', is_correct: true },
    ],
  },
  {
    subject: 'IELTS',
    tag: 'Reading',
    difficulty: 'medium',
    qtype: 'single',
    question: 'In IELTS Reading, "Not Given" means the information ___.',
    points: 1,
    options: [
      { text: 'contradicts the passage', is_correct: false },
      { text: 'cannot be confirmed from the passage', is_correct: true },
      { text: 'is stated in the passage', is_correct: false },
    ],
  },
  {
    subject: 'IELTS',
    tag: 'Writing',
    difficulty: 'hard',
    qtype: 'essay',
    question:
      'Some people think universities should focus on job skills, others believe education has a wider purpose. Discuss both views and give your opinion (≥ 250 words).',
    points: 5,
    options: [],
  },
  {
    subject: 'TOEIC',
    tag: 'Part 5',
    difficulty: 'easy',
    qtype: 'single',
    question: 'The quarterly report must be submitted ___ Friday.',
    points: 1,
    options: [
      { text: 'by', is_correct: true },
      { text: 'until', is_correct: false },
      { text: 'during', is_correct: false },
      { text: 'since', is_correct: false },
    ],
  },
  {
    subject: 'TOEIC',
    tag: 'Part 5',
    difficulty: 'medium',
    qtype: 'single',
    question: 'Ms. Tran was ___ to the position of regional manager last month.',
    points: 1,
    options: [
      { text: 'promoted', is_correct: true },
      { text: 'promotion', is_correct: false },
      { text: 'promoting', is_correct: false },
      { text: 'promotes', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Hàn',
    tag: 'Từ vựng',
    difficulty: 'easy',
    qtype: 'single',
    question: '"감사합니다" có nghĩa là gì?',
    points: 1,
    options: [
      { text: 'Xin chào', is_correct: false },
      { text: 'Cảm ơn', is_correct: true },
      { text: 'Xin lỗi', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Trung',
    tag: 'HSK 3',
    difficulty: 'medium',
    qtype: 'single',
    question: 'Chọn lượng từ đúng: 一 ___ 书',
    points: 1,
    options: [
      { text: '个', is_correct: false },
      { text: '本', is_correct: true },
      { text: '张', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Hàn',
    tag: 'Ngữ pháp',
    difficulty: 'medium',
    qtype: 'single',
    question: 'Chọn tiểu từ đúng: 저___ 학생입니다.',
    points: 1,
    options: [
      { text: '는', is_correct: true },
      { text: '를', is_correct: false },
      { text: '에', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Hàn',
    tag: 'Từ vựng',
    difficulty: 'easy',
    qtype: 'truefalse',
    question: '"학교" nghĩa là "trường học".',
    points: 1,
    options: [
      { text: 'Đúng', is_correct: true },
      { text: 'Sai', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Trung',
    tag: 'HSK 3',
    difficulty: 'easy',
    qtype: 'single',
    question: '"我们一起去吃饭吧" có nghĩa là gì?',
    points: 1,
    options: [
      { text: 'Chúng ta cùng đi ăn cơm nhé', is_correct: true },
      { text: 'Tôi đã ăn cơm rồi', is_correct: false },
      { text: 'Bạn muốn ăn gì?', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Trung',
    tag: 'HSK 3',
    difficulty: 'hard',
    qtype: 'multiple',
    question: 'Những từ nào là động từ năng nguyện?',
    points: 2,
    options: [
      { text: '会', is_correct: true },
      { text: '能', is_correct: true },
      { text: '很', is_correct: false },
      { text: '可以', is_correct: true },
    ],
  },
  {
    subject: 'Tiếng Nhật',
    tag: 'N5',
    difficulty: 'medium',
    qtype: 'single',
    question: 'Chọn trợ từ đúng: わたし___ がくせいです。',
    points: 1,
    options: [
      { text: 'は', is_correct: true },
      { text: 'を', is_correct: false },
      { text: 'に', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Nhật',
    tag: 'N5',
    difficulty: 'easy',
    qtype: 'single',
    question: '"ありがとう" nghĩa là gì?',
    points: 1,
    options: [
      { text: 'Cảm ơn', is_correct: true },
      { text: 'Tạm biệt', is_correct: false },
      { text: 'Xin lỗi', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Nhật',
    tag: 'N5',
    difficulty: 'easy',
    qtype: 'truefalse',
    question: '"おはようございます" dùng để chào buổi sáng.',
    points: 1,
    options: [
      { text: 'Đúng', is_correct: true },
      { text: 'Sai', is_correct: false },
    ],
  },
  {
    subject: 'Tiếng Anh',
    tag: 'Vocabulary',
    difficulty: 'easy',
    qtype: 'single',
    question: 'Choose the synonym of "rapid".',
    points: 1,
    options: [
      { text: 'slow', is_correct: false },
      { text: 'quick', is_correct: true },
      { text: 'calm', is_correct: false },
      { text: 'heavy', is_correct: false },
    ],
  },
];

/** Bài tập thường theo môn: [tiêu đề, nội dung markdown]. */
export const HOMEWORK_TEXT: Record<string, [string, string][]> = {
  IELTS: [
    [
      'Writing Task 1 – Bar chart',
      'Viết **150 từ** mô tả biểu đồ trang 42 sách Cambridge 17.\n\n- Có overview rõ ràng\n- So sánh ít nhất 2 nhóm số liệu',
    ],
    ['Reading Test 3 – Passage 1', 'Làm Passage 1 (13 câu) trong **20 phút**, ghi lại thời gian thực tế.'],
  ],
  'Tiếng Anh': [
    ['Từ vựng Unit 5 – Travel', 'Học 20 từ trong danh sách, đặt câu với 5 từ bất kỳ.'],
    ['Luyện nghe Podcast 6 Minute English', 'Nghe tập "Why do we procrastinate?" và tóm tắt 5 ý chính.'],
  ],
  TOEIC: [
    ['Part 7 – Double passages', 'Làm 2 bộ đoạn đôi trang 118–121, đánh dấu từ khóa.'],
    ['Từ vựng chủ đề Office', 'Ôn 30 từ chủ đề văn phòng, làm bài trắc nghiệm cuối chương.'],
  ],
  'Tiếng Hàn': [['Bảng chữ Hangul – phụ âm kép', 'Viết mỗi phụ âm kép 2 dòng, ghi âm đọc và gửi kèm.']],
  'Tiếng Trung': [['Luyện viết chữ Hán bài 6', 'Viết 15 chữ mới, mỗi chữ 1 dòng, chú ý thứ tự nét.']],
  'Tiếng Nhật': [['Katakana – từ mượn', 'Chép 20 từ mượn tiếng Anh bằng Katakana, kèm nghĩa.']],
};

export const REVIEWS: { rating: number; comment: string; approve: boolean }[] = [
  {
    rating: 5,
    comment:
      'Con học IELTS ở đây 4 tháng, từ 5.0 lên 6.0. Cô Quỳnh Anh chữa Writing rất kỹ, tuần nào cũng có nhận xét chi tiết.',
    approve: true,
  },
  {
    rating: 5,
    comment:
      'Lớp thiếu nhi vui, bé nhà mình đi học tự giác hơn hẳn. Thông báo học phí và lịch học qua Zalo rất tiện.',
    approve: true,
  },
  {
    rating: 4,
    comment: 'Giáo viên nhiệt tình, phòng học sạch. Mong trung tâm mở thêm ca sáng cuối tuần.',
    approve: true,
  },
  {
    rating: 5,
    comment: 'Xem điểm danh và bài tập của con ngay trên điện thoại, không phải hỏi giáo viên nữa.',
    approve: true,
  },
  {
    rating: 4,
    comment: 'Học phí hợp lý so với chất lượng. Lớp đông vừa phải nên cô theo sát được.',
    approve: false,
  },
];

/** Phụ huynh có tài khoản (mật khẩu demo 123456), liên kết theo số thứ tự học viên mới (0-based). */
export const PARENTS: { name: string; phone: string; children: number[] }[] = [
  { name: 'Nguyễn Thị Thu Hằng', phone: '0901234501', children: [0, 15] },
  { name: 'Trần Quốc Dũng', phone: '0901234502', children: [1] },
  { name: 'Lê Thị Mỹ Hạnh', phone: '0901234503', children: [2, 3] },
  { name: 'Phạm Văn Thắng', phone: '0901234504', children: [4] },
  { name: 'Hoàng Thị Ngọc Lan', phone: '0901234505', children: [16] },
  { name: 'Vũ Minh Hoàng', phone: '0901234506', children: [17] },
  { name: 'Đặng Thị Kim Chi', phone: '0901234507', children: [5, 6] },
  { name: 'Bùi Văn Hải', phone: '0901234508', children: [18] },
];

export const LEAVE_REASONS = [
  'Con bị sốt, bác sĩ cho nghỉ 2 ngày',
  'Gia đình về quê dự đám cưới',
  'Trùng lịch thi học kỳ ở trường',
  'Con đi khám răng định kỳ',
];

export const HOMEWORK_FEEDBACK = [
  'Bài làm đầy đủ, trình bày rõ ràng.',
  'Từ vựng tốt, cần chú ý chia động từ.',
  'Ý chính đúng, mở bài cần ngắn gọn hơn.',
  'Tiến bộ rõ so với bài trước, tiếp tục phát huy.',
  'Còn lỗi chính tả, xem lại phần đã gạch chân.',
  '',
];
