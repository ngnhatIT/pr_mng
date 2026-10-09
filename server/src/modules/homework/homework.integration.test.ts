/**
 * Integration test cho module homework (service + quiz + targets).
 *
 * - Dùng DB SQLite in-memory RIÊNG, không động vào data.db thật.
 * - Kỹ thuật: poison require.cache của '../../db' TRƯỚC KHI load services,
 *   để mọi service nhận testDb thay vì singleton production.
 * - Chạy bằng: node --test dist/modules/homework/homework.integration.test.js
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

declare const require: NodeRequire;

// ---------------------------------------------------------------------------
// 1. Setup: DB in-memory + schema + migrations (không side-effect lên disk)
// ---------------------------------------------------------------------------
const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');

const { createSchema } = require('../../db/schema') as typeof import('../../db/schema');
const { runMigrations } = require('../../db/migrations') as typeof import('../../db/migrations');
const { runVersionedMigrations } = require('../../db/versionedMigrations') as typeof import('../../db/versionedMigrations');
const { createIndexes } = require('../../db/indexes') as typeof import('../../db/indexes');
createSchema(testDb);
runMigrations(testDb);
runVersionedMigrations(testDb);
createIndexes(testDb);

// Helpers thay thế db/helpers (vốn bám singleton thật) — bám testDb
function getSetting(key: string, fallback = ''): string {
  const row = testDb.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  if (!row || row.value === null || row.value === undefined) return fallback;
  return row.value;
}
function getCenterSetting(centerId: number, key: string, fallback = ''): string {
  const row = testDb
    .prepare('SELECT value FROM center_settings WHERE center_id = ? AND key = ?')
    .get(centerId, key) as { value: string | null } | undefined;
  if (row && row.value !== null && row.value !== undefined) return row.value;
  return getSetting(key, fallback);
}
function confirmedPaid(invoiceId: number): number {
  const row = testDb
    .prepare("SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
    .get(invoiceId) as { paid: number };
  return row.paid;
}
const { toISODate, formatSchedule } = require('../../db/date-utils') as typeof import('../../db/date-utils');

// Poison module cache: mọi `require('../../db')` sau đây nhận testDb
const dbModulePath: string = require.resolve('../../db');
(require.cache as unknown as Record<string, unknown>)[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { db: testDb, getSetting, getCenterSetting, toISODate, confirmedPaid, formatSchedule },
} as never;

// ---------------------------------------------------------------------------
// 2. Load services (SAU khi poison — chúng sẽ dùng testDb)
// ---------------------------------------------------------------------------
const homeworkService = require('./homework.service') as typeof import('./homework.service');
const quizService = require('./quiz.service') as typeof import('./quiz.service');
const parentService = require('../parent/parent.service') as typeof import('../parent/parent.service');

// ---------------------------------------------------------------------------
// 3. Fixtures
// ---------------------------------------------------------------------------
let classId = 0;
let student1Id = 0;
let student2Id = 0;
let parent1Id = 0;
let parent2Id = 0;

const VALID_QUESTIONS = [
  {
    question: '2 + 2 = ?',
    points: 2,
    options: [
      { text: '3', is_correct: false },
      { text: '4', is_correct: true },
    ],
  },
  {
    question: '3 + 3 = ?',
    points: 3,
    options: [
      { text: '6', is_correct: true },
      { text: '5', is_correct: false },
    ],
  },
];

function resetDb(): void {
  const tables = [
    'homework_targets', 'homework_attachments', 'quiz_answers', 'quiz_attempts',
    'quiz_options', 'quiz_questions', 'homework_scores', 'homework_completions',
    'homework_submissions', 'reminders', 'homework',
    'parent_students', 'parents', 'enrollments', 'students', 'classes',
  ];
  for (const t of tables) testDb.prepare(`DELETE FROM ${t}`).run();

  classId = Number(testDb.prepare("INSERT INTO classes (name) VALUES ('Lớp Test')").run().lastInsertRowid);
  student1Id = Number(
    testDb.prepare("INSERT INTO students (code, name) VALUES ('ST001', 'Học viên 1')").run().lastInsertRowid
  );
  student2Id = Number(
    testDb.prepare("INSERT INTO students (code, name) VALUES ('ST002', 'Học viên 2')").run().lastInsertRowid
  );
  testDb.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(student1Id, classId);
  testDb.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(student2Id, classId);
  parent1Id = Number(
    testDb.prepare("INSERT INTO parents (phone, password_hash, name) VALUES ('0900000001', 'x', 'PH 1')").run()
      .lastInsertRowid
  );
  parent2Id = Number(
    testDb.prepare("INSERT INTO parents (phone, password_hash, name) VALUES ('0900000002', 'x', 'PH 2')").run()
      .lastInsertRowid
  );
  testDb.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parent1Id, student1Id);
  testDb.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parent2Id, student2Id);
}

/** Lấy question + option ids của quiz để nộp bài. */
function getQuizIds(homeworkId: number): { qid: number; correctOpt: number; wrongOpt: number }[] {
  const qs = testDb.prepare('SELECT id FROM quiz_questions WHERE homework_id = ? ORDER BY id').all(homeworkId) as {
    id: number;
  }[];
  return qs.map((q) => {
    const opts = testDb.prepare('SELECT id, is_correct FROM quiz_options WHERE question_id = ?').all(q.id) as {
      id: number;
      is_correct: number;
    }[];
    return {
      qid: q.id,
      correctOpt: opts.find((o) => o.is_correct === 1)!.id,
      wrongOpt: opts.find((o) => o.is_correct !== 1)!.id,
    };
  });
}

function count(table: string, where = ''): number {
  return (testDb.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get() as { c: number }).c;
}

// ---------------------------------------------------------------------------
// 4. Tests
// ---------------------------------------------------------------------------

describe('homework.service - createHomeworkBatch', () => {
  beforeEach(resetDb);

  it('tạo bài published — status và dữ liệu đúng', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Bài 1', content: 'Làm bài tập', created_by: 1, centerId: null,
      status: 'published', max_score: 10,
    });
    assert.equal(hw.status, 'published');
    assert.equal(hw.title, 'Bài 1');
    assert.equal(hw.max_score, 10);
    assert.equal(hw.class_id, classId);
  });

  it('tạo bài draft và scheduled', () => {
    const [d] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Nháp', created_by: 1, centerId: null, status: 'draft',
    });
    assert.equal(d.status, 'draft');

    const [s] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Hẹn giờ', created_by: 1, centerId: null,
      status: 'scheduled', publish_at: '2030-01-01T10:00',
    });
    assert.equal(s.status, 'scheduled');
    assert.equal(s.publish_at, '2030-01-01T10:00');
  });

  it('tạo 1 lần cho nhiều lớp', () => {
    const class2 = Number(testDb.prepare("INSERT INTO classes (name) VALUES ('Lớp 2')").run().lastInsertRowid);
    const created = homeworkService.createHomeworkBatch({
      class_ids: [classId, class2], title: 'Chung', created_by: 1, centerId: null,
    });
    assert.equal(created.length, 2);
  });

  it('thiếu lớp → throw', () => {
    assert.throws(
      () => homeworkService.createHomeworkBatch({ class_ids: [], title: 'X', created_by: 1, centerId: null }),
      /ít nhất 1 lớp/
    );
  });

  it('thiếu tiêu đề → throw', () => {
    assert.throws(
      () => homeworkService.createHomeworkBatch({ class_ids: [classId], title: '  ', created_by: 1, centerId: null }),
      /tiêu đề/
    );
  });

  it('scheduled thiếu publish_at → throw', () => {
    assert.throws(
      () =>
        homeworkService.createHomeworkBatch({
          class_ids: [classId], title: 'X', created_by: 1, centerId: null, status: 'scheduled',
        }),
      /Hẹn giờ/
    );
  });

  it('close_date < due_date → throw', () => {
    assert.throws(
      () =>
        homeworkService.createHomeworkBatch({
          class_ids: [classId], title: 'X', created_by: 1, centerId: null,
          due_date: '2026-10-20', close_date: '2026-10-10',
        }),
      /Hạn chót cứng phải sau hạn nộp/
    );
  });

  it('định dạng ngày sai → throw', () => {
    assert.throws(
      () =>
        homeworkService.createHomeworkBatch({
          class_ids: [classId], title: 'X', created_by: 1, centerId: null, due_date: '20/10/2026',
        }),
      /Hạn nộp không hợp lệ/
    );
  });
});

describe('quiz.service - tạo đề và validate', () => {
  beforeEach(resetDb);

  function createQuizHw(): number {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz 1', created_by: 1, centerId: null, kind: 'quiz',
    });
    return hw.id;
  }

  it('tạo quiz hợp lệ — đếm đúng số câu', () => {
    const id = createQuizHw();
    quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    assert.equal(quizService.countQuizQuestions(id), 2);
  });

  it('quiz rỗng → throw (không tạo đề trống)', () => {
    const id = createQuizHw();
    assert.throws(() => quizService.saveQuizQuestions(id, []), /ít nhất 1 câu/);
    assert.equal(quizService.countQuizQuestions(id), 0);
  });

  it('câu thiếu nội dung → throw', () => {
    const id = createQuizHw();
    assert.throws(
      () =>
        quizService.saveQuizQuestions(id, [
          { question: '  ', points: 1, options: [{ text: 'A', is_correct: true }, { text: 'B', is_correct: false }] },
        ]),
      /chưa có nội dung/
    );
  });

  it('câu chỉ có 1 đáp án → throw', () => {
    const id = createQuizHw();
    assert.throws(
      () =>
        quizService.saveQuizQuestions(id, [
          { question: 'Q?', points: 1, options: [{ text: 'A', is_correct: true }] },
        ]),
      /ít nhất 2 đáp án/
    );
  });

  it('câu không có đáp án đúng → throw', () => {
    const id = createQuizHw();
    assert.throws(
      () =>
        quizService.saveQuizQuestions(id, [
          { question: 'Q?', points: 1, options: [{ text: 'A', is_correct: false }, { text: 'B', is_correct: false }] },
        ]),
      /đáp án đúng/
    );
  });

  it('đáp án trùng nội dung → throw', () => {
    const id = createQuizHw();
    assert.throws(
      () =>
        quizService.saveQuizQuestions(id, [
          { question: 'Q?', points: 1, options: [{ text: 'A', is_correct: true }, { text: ' a ', is_correct: false }] },
        ]),
      /trùng/
    );
  });

  it('validate lỗi thì đề cũ không bị xóa (atomic)', () => {
    const id = createQuizHw();
    quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    assert.throws(() => quizService.saveQuizQuestions(id, []), /ít nhất 1 câu/);
    // Đề cũ vẫn nguyên 2 câu
    assert.equal(quizService.countQuizQuestions(id), 2);
  });
});

describe('quiz.service - nộp bài và chấm điểm', () => {
  beforeEach(resetDb);

  function setupQuiz(): number {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz chấm', created_by: 1, centerId: null, kind: 'quiz',
    });
    quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    return hw.id;
  }

  it('chấm đúng: 1 đúng (2đ) + 1 sai → 2/5', () => {
    const id = setupQuiz();
    const [q1, q2] = getQuizIds(id);
    const r = quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ]);
    assert.equal(r.score, 2);
    assert.equal(r.max_score, 5);
    assert.equal(r.attempt_no, 1);
    assert.ok(r.attempt_id > 0);
  });

  it('làm lại: attempt_no tăng, giữ điểm cao nhất', () => {
    const id = setupQuiz();
    const [q1, q2] = getQuizIds(id);
    // Lượt 1: đúng 1 câu → 2đ
    quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ]);
    // Lượt 2: đúng hết → 5đ
    const r2 = quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.correctOpt },
    ]);
    assert.equal(r2.attempt_no, 2);
    assert.equal(r2.score, 5);
    // homework_scores giữ điểm cao nhất
    const s = homeworkService.getStudentScore(id, student1Id);
    assert.equal(s?.score, 5);
    assert.equal(count('quiz_attempts', `WHERE homework_id = ${id} AND student_id = ${student1Id}`), 2);
  });

  it('quá hạn chót (close_date) → không nộp được', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz hết hạn', created_by: 1, centerId: null, kind: 'quiz',
      due_date: '2020-01-01', close_date: '2020-01-02',
    });
    quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    const [q1] = getQuizIds(hw.id);
    assert.throws(
      () => quizService.submitQuiz(hw.id, student1Id, [{ question_id: q1.qid, option_id: q1.correctOpt }]),
      /quá hạn/
    );
  });

  it('sửa đề sau khi đã có attempt → throw', () => {
    const id = setupQuiz();
    const [q1] = getQuizIds(id);
    quizService.submitQuiz(id, student1Id, [{ question_id: q1.qid, option_id: q1.correctOpt }]);
    assert.equal(quizService.countQuizAttempts(id), 1);
    assert.throws(() => quizService.saveQuizQuestions(id, VALID_QUESTIONS), /Đã có học viên làm bài/);
  });

  it('lịch sử attempts của học viên', () => {
    const id = setupQuiz();
    const [q1, q2] = getQuizIds(id);
    const ans = [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ];
    quizService.submitQuiz(id, student1Id, ans);
    quizService.submitQuiz(id, student1Id, ans);
    const attempts = quizService.getStudentAttempts(id, student1Id);
    assert.equal(attempts.length, 2);
  });
});

describe('homework.service - chấm điểm tay', () => {
  beforeEach(resetDb);

  it('chấm vượt max_score → throw', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'B', created_by: 1, centerId: null, max_score: 10,
    });
    assert.throws(() => homeworkService.gradeHomework(hw.id, student1Id, 15, null, 1), /không được vượt quá 10/);
    // Điểm không bị ghi
    assert.equal(homeworkService.getStudentScore(hw.id, student1Id)?.score ?? null, null);
  });

  it('chấm trong giới hạn → lưu điểm + feedback', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'B', created_by: 1, centerId: null, max_score: 10,
    });
    homeworkService.gradeHomework(hw.id, student1Id, 8, 'Tốt', 1);
    const s = homeworkService.getStudentScore(hw.id, student1Id);
    assert.equal(s?.score, 8);
    assert.equal(s?.feedback, 'Tốt');
  });
});

describe('homework.service - xóa cascade', () => {
  beforeEach(resetDb);

  it('xóa bài tập xóa sạch quiz/attempts/answers/scores/submissions/targets', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz xóa', created_by: 1, centerId: null, kind: 'quiz',
      target_student_ids: [student1Id],
    });
    quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    const [q1, q2] = getQuizIds(hw.id);
    quizService.submitQuiz(hw.id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.correctOpt },
    ]);
    homeworkService.gradeHomework(hw.id, student1Id, 5, null, 1);
    testDb.prepare('INSERT INTO homework_submissions (homework_id, student_id, note) VALUES (?, ?, ?)').run(hw.id, student1Id, 'nộp');
    testDb.prepare('INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, ?, ?, ?)').run(hw.id, 'f', 'u', 'link');

    // Sanity: dữ liệu tồn tại trước khi xóa
    assert.ok(count('quiz_questions', `WHERE homework_id = ${hw.id}`) > 0);
    assert.ok(count('quiz_attempts', `WHERE homework_id = ${hw.id}`) > 0);

    homeworkService.deleteHomework(hw.id);

    const w = `WHERE homework_id = ${hw.id}`;
    assert.equal(count('homework', `WHERE id = ${hw.id}`), 0);
    assert.equal(count('quiz_questions', w), 0);
    assert.equal(count('quiz_options', `WHERE question_id NOT IN (SELECT id FROM quiz_questions)`), 0);
    assert.equal(count('quiz_attempts', w), 0);
    assert.equal(count('quiz_answers'), 0);
    assert.equal(count('homework_scores', w), 0);
    assert.equal(count('homework_completions', w), 0);
    assert.equal(count('homework_submissions', w), 0);
    assert.equal(count('homework_attachments', w), 0);
    assert.equal(count('homework_targets', w), 0);
  });
});

describe('homework.service - publishScheduled (giờ VN)', () => {
  beforeEach(resetDb);

  it('publish bài hẹn giờ đã đến hạn', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Hẹn', created_by: 1, centerId: null,
      status: 'scheduled', publish_at: '2020-01-01T00:00',
    });
    const n = homeworkService.publishScheduled();
    assert.equal(n, 1);
    const row = testDb.prepare('SELECT status FROM homework WHERE id = ?').get(hw.id) as { status: string };
    assert.equal(row.status, 'published');
    // NOTE: notifyHomeworkPublished hiện INSERT vào reminders(center_id,...) nhưng bảng
    // reminders chưa có cột center_id nên bị nuốt lỗi — không assert side-effect này.
  });

  it('không publish bài hẹn giờ tương lai', () => {
    homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Hẹn TL', created_by: 1, centerId: null,
      status: 'scheduled', publish_at: '2030-01-01T00:00',
    });
    assert.equal(homeworkService.publishScheduled(), 0);
  });

  it('không publish bài draft', () => {
    homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Nháp', created_by: 1, centerId: null, status: 'draft',
    });
    assert.equal(homeworkService.publishScheduled(), 0);
  });
});

describe('giao riêng từng học viên (targets)', () => {
  beforeEach(resetDb);

  it('lưu đúng danh sách target', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Phụ đạo', created_by: 1, centerId: null,
      target_student_ids: [student1Id],
    });
    const targets = testDb.prepare('SELECT student_id FROM homework_targets WHERE homework_id = ?').all(hw.id) as {
      student_id: number;
    }[];
    assert.deepEqual(targets.map((t) => t.student_id), [student1Id]);
  });

  it('bài giao riêng: đúng học viên xem được, học viên khác bị chặn', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz riêng', created_by: 1, centerId: null, kind: 'quiz',
      target_student_ids: [student1Id],
    });
    quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);

    // Parent của học viên trong target → xem được đề
    const qs = parentService.getQuizForChild(parent1Id, student1Id, hw.id);
    assert.ok(Array.isArray(qs));
    assert.equal(qs.length, 2);

    // Parent của học viên ngoài target → bị chặn
    assert.throws(() => parentService.getQuizForChild(parent2Id, student2Id, hw.id), /Không tìm thấy bài quiz/);
  });

  it('bài giao riêng: tick hoàn thành chỉ đúng đối tượng', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Bài riêng', created_by: 1, centerId: null,
      target_student_ids: [student1Id],
    });
    // Ngoài target → chặn
    assert.throws(() => parentService.markHomeworkComplete(parent2Id, student2Id, hw.id), /Không tìm thấy bài tập/);
    // Trong target → ok
    parentService.markHomeworkComplete(parent1Id, student1Id, hw.id);
    assert.equal(count('homework_completions', `WHERE homework_id = ${hw.id} AND student_id = ${student1Id}`), 1);
  });

  it('bài không giao riêng: mọi học viên trong lớp đều thấy', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Quiz chung', created_by: 1, centerId: null, kind: 'quiz',
    });
    quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    assert.equal(parentService.getQuizForChild(parent1Id, student1Id, hw.id).length, 2);
    assert.equal(parentService.getQuizForChild(parent2Id, student2Id, hw.id).length, 2);
  });
});

describe('homework.service - update và reuse', () => {
  beforeEach(resetDb);

  it('update tiêu đề + điểm + hạn', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Cũ', created_by: 1, centerId: null, max_score: 10,
    });
    homeworkService.updateHomework(hw.id, {
      title: 'Mới', max_score: 20, due_date: '2026-12-01', close_date: '2026-12-05',
    });
    const row = testDb.prepare('SELECT title, max_score, due_date, close_date FROM homework WHERE id = ?').get(hw.id) as {
      title: string; max_score: number; due_date: string; close_date: string;
    };
    assert.equal(row.title, 'Mới');
    assert.equal(row.max_score, 20);
    assert.equal(row.due_date, '2026-12-01');
  });

  it('reuse copy targets sang bài mới', () => {
    const [hw] = homeworkService.createHomeworkBatch({
      class_ids: [classId], title: 'Gốc', created_by: 1, centerId: null,
      target_student_ids: [student1Id, student2Id],
    });
    const [copy] = homeworkService.reuseHomework(hw.id, 1, null);
    assert.notEqual(copy.id, hw.id);
    const targets = testDb.prepare('SELECT student_id FROM homework_targets WHERE homework_id = ? ORDER BY student_id').all(copy.id) as {
      student_id: number;
    }[];
    assert.deepEqual(targets.map((t) => t.student_id), [student1Id, student2Id]);
  });
});
