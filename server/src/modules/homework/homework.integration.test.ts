/**
 * Integration test trên PostgreSQL.
 * Dùng database test RIÊNG (educenter_test), không động vào DB chính.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import * as homeworkService from './homework.service';
import * as quizService from './quiz.service';
import * as parentService from '../parent/parent.service';
import { createRubric } from './rubric.service';
import { addBankQuestion, updateBankQuestion } from './questionBank.service';
import { eventBus } from '../../shared/events/eventBus';

// ---------------------------------------------------------------------------
// Fixtures
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

async function resetDb(): Promise<void> {
  await resetTestDb();

  // User cố định id=1 cho các fixture created_by/graded_by (FK bắt buộc user có thật)
  await db
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, name) VALUES (1, 'tester', 'x', 'staff', 'Tester')"
    )
    .run();

  const cr = await db.prepare("INSERT INTO classes (name) VALUES ('Lớp Test')").run();
  classId = Number(cr.lastInsertRowid);
  const s1 = await db.prepare("INSERT INTO students (code, name) VALUES ('ST001', 'Học viên 1')").run();
  student1Id = Number(s1.lastInsertRowid);
  const s2 = await db.prepare("INSERT INTO students (code, name) VALUES ('ST002', 'Học viên 2')").run();
  student2Id = Number(s2.lastInsertRowid);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(student1Id, classId);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(student2Id, classId);
  const p1 = await db
    .prepare("INSERT INTO parents (phone, password_hash, name) VALUES ('0900000001', 'x', 'PH 1')")
    .run();
  parent1Id = Number(p1.lastInsertRowid);
  const p2 = await db
    .prepare("INSERT INTO parents (phone, password_hash, name) VALUES ('0900000002', 'x', 'PH 2')")
    .run();
  parent2Id = Number(p2.lastInsertRowid);
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parent1Id, student1Id);
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parent2Id, student2Id);
}

/** Lấy question + option ids của quiz để nộp bài. */
async function getQuizIds(
  homeworkId: number
): Promise<{ qid: number; correctOpt: number; wrongOpt: number }[]> {
  const qs = (await db
    .prepare('SELECT id FROM quiz_questions WHERE homework_id = ? ORDER BY id')
    .all(homeworkId)) as {
    id: number;
  }[];
  const out: { qid: number; correctOpt: number; wrongOpt: number }[] = [];
  for (const q of qs) {
    const opts = (await db
      .prepare('SELECT id, is_correct FROM quiz_options WHERE question_id = ?')
      .all(q.id)) as {
      id: number;
      is_correct: number;
    }[];
    out.push({
      qid: q.id,
      correctOpt: opts.find((o) => Number(o.is_correct) === 1)!.id,
      wrongOpt: opts.find((o) => Number(o.is_correct) !== 1)!.id,
    });
  }
  return out;
}

async function count(table: string, where = ''): Promise<number> {
  const r = await db.query(`SELECT COUNT(*)::int as c FROM ${table} ${where}`);
  return (r.rows[0] as { c: number }).c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Setup/teardown chung cho cả file (1 lần)
before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('homework.service - createHomeworkBatch', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('tạo bài published — status và dữ liệu đúng', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài 1',
      content: 'Làm bài tập',
      created_by: 1,
      centerId: null,
      status: 'published',
      max_score: 10,
    });
    assert.equal(hw.status, 'published');
    assert.equal(hw.title, 'Bài 1');
    assert.equal(hw.max_score, 10);
    assert.equal(hw.class_id, classId);
  });

  it('tạo bài draft và scheduled', async () => {
    const [d] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Nháp',
      created_by: 1,
      centerId: null,
      status: 'draft',
    });
    assert.equal(d.status, 'draft');

    const [s] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Hẹn giờ',
      created_by: 1,
      centerId: null,
      status: 'scheduled',
      publish_at: '2030-01-01T10:00',
    });
    assert.equal(s.status, 'scheduled');
    assert.equal(s.publish_at, '2030-01-01T10:00');
  });

  it('tạo 1 lần cho nhiều lớp', async () => {
    const cr = await db.prepare("INSERT INTO classes (name) VALUES ('Lớp 2')").run();
    const class2 = Number(cr.lastInsertRowid);
    const created = await homeworkService.createHomeworkBatch({
      class_ids: [classId, class2],
      title: 'Chung',
      created_by: 1,
      centerId: null,
    });
    assert.equal(created.length, 2);
  });

  it('thiếu lớp → throw', async () => {
    await assert.rejects(
      homeworkService.createHomeworkBatch({ class_ids: [], title: 'X', created_by: 1, centerId: null }),
      /ít nhất 1 lớp/
    );
  });

  it('thiếu tiêu đề → throw', async () => {
    await assert.rejects(
      homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: '  ',
        created_by: 1,
        centerId: null,
      }),
      /tiêu đề/
    );
  });

  it('scheduled thiếu publish_at → throw', async () => {
    await assert.rejects(
      homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: 'X',
        created_by: 1,
        centerId: null,
        status: 'scheduled',
      }),
      /Hẹn giờ/
    );
  });

  it('close_date < due_date → throw', async () => {
    await assert.rejects(
      homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: 'X',
        created_by: 1,
        centerId: null,
        due_date: '2026-10-20',
        close_date: '2026-10-10',
      }),
      /Hạn chót cứng phải sau hạn nộp/
    );
  });

  it('định dạng ngày sai → throw', async () => {
    await assert.rejects(
      homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: 'X',
        created_by: 1,
        centerId: null,
        due_date: '20/10/2026',
      }),
      /Hạn nộp không hợp lệ/
    );
  });
});

describe('quiz.service - tạo đề và validate', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createQuizHw(): Promise<number> {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz 1',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
    });
    return hw.id;
  }

  it('tạo quiz hợp lệ — đếm đúng số câu', async () => {
    const id = await createQuizHw();
    await quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    assert.equal(await quizService.countQuizQuestions(id), 2);
  });

  it('quiz rỗng → throw (không tạo đề trống)', async () => {
    const id = await createQuizHw();
    await assert.rejects(quizService.saveQuizQuestions(id, []), /ít nhất 1 câu/);
    assert.equal(await quizService.countQuizQuestions(id), 0);
  });

  it('câu thiếu nội dung → throw', async () => {
    const id = await createQuizHw();
    await assert.rejects(
      quizService.saveQuizQuestions(id, [
        {
          question: '  ',
          points: 1,
          options: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: false },
          ],
        },
      ]),
      /chưa có nội dung/
    );
  });

  it('câu chỉ có 1 đáp án → throw', async () => {
    const id = await createQuizHw();
    await assert.rejects(
      quizService.saveQuizQuestions(id, [
        { question: 'Q?', points: 1, options: [{ text: 'A', is_correct: true }] },
      ]),
      /ít nhất 2 đáp án/
    );
  });

  it('câu không có đáp án đúng → throw', async () => {
    const id = await createQuizHw();
    await assert.rejects(
      quizService.saveQuizQuestions(id, [
        {
          question: 'Q?',
          points: 1,
          options: [
            { text: 'A', is_correct: false },
            { text: 'B', is_correct: false },
          ],
        },
      ]),
      /đáp án đúng/
    );
  });

  it('đáp án trùng nội dung → throw', async () => {
    const id = await createQuizHw();
    await assert.rejects(
      quizService.saveQuizQuestions(id, [
        {
          question: 'Q?',
          points: 1,
          options: [
            { text: 'A', is_correct: true },
            { text: ' a ', is_correct: false },
          ],
        },
      ]),
      /trùng/
    );
  });

  it('validate lỗi thì đề cũ không bị xóa (atomic)', async () => {
    const id = await createQuizHw();
    await quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    await assert.rejects(quizService.saveQuizQuestions(id, []), /ít nhất 1 câu/);
    // Đề cũ vẫn nguyên 2 câu
    assert.equal(await quizService.countQuizQuestions(id), 2);
  });

  it('validateQuizQuestions: câu thiếu đáp án đúng → throw (dùng chung cho POST /)', async () => {
    assert.throws(
      () =>
        quizService.validateQuizQuestions([
          {
            question: 'Q?',
            points: 1,
            options: [
              { text: 'A', is_correct: false },
              { text: 'B', is_correct: false },
            ],
          },
        ]),
      /chưa chọn đáp án đúng/
    );
  });

  it('validateQuizQuestions: bộ câu hỏi hợp lệ → không throw', async () => {
    quizService.validateQuizQuestions(VALID_QUESTIONS);
  });

  it('P0-2: câu hỏi lỗi → validate trước insert nên không tạo bài tập nào', async () => {
    const before = await count('homework');
    const badQuestions = [
      {
        question: 'Q?',
        points: 1,
        options: [
          { text: 'A', is_correct: false },
          { text: 'B', is_correct: false },
        ],
      },
    ];
    // Mô phỏng đúng thứ tự của POST /: validate trước, createHomeworkBatch sau
    await assert.rejects(async () => {
      quizService.validateQuizQuestions(badQuestions);
      await homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: 'Quiz lỗi',
        created_by: 1,
        centerId: null,
        kind: 'quiz',
      });
    }, /chưa chọn đáp án đúng/);
    assert.equal(await count('homework'), before);
  });
});

describe('quiz.service - nộp bài và chấm điểm', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setupQuiz(): Promise<number> {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz chấm',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
    });
    await quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    return hw.id;
  }

  it('chấm đúng: 1 đúng (2đ) + 1 sai → 2/5', async () => {
    const id = await setupQuiz();
    const [q1, q2] = await getQuizIds(id);
    const r = await quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ]);
    assert.equal(r.score, 2);
    assert.equal(r.max_score, 5);
    assert.equal(r.attempt_no, 1);
    assert.ok(r.attempt_id > 0);
  });

  it('làm lại: attempt_no tăng, giữ điểm cao nhất', async () => {
    const id = await setupQuiz();
    const [q1, q2] = await getQuizIds(id);
    // Lượt 1: đúng 1 câu → 2đ
    await quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ]);
    // Lượt 2: đúng hết → 5đ
    const r2 = await quizService.submitQuiz(id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.correctOpt },
    ]);
    assert.equal(r2.attempt_no, 2);
    assert.equal(r2.score, 5);
    // homework_scores giữ điểm cao nhất
    const s = await homeworkService.getStudentScore(id, student1Id);
    assert.equal(s?.score, 5);
    assert.equal(await count('quiz_attempts', `WHERE homework_id = ${id} AND student_id = ${student1Id}`), 2);
  });

  it('quá hạn chót (close_date) → không nộp được', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz hết hạn',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      due_date: '2020-01-01',
      close_date: '2020-01-02',
    });
    await quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    const [q1] = await getQuizIds(hw.id);
    await assert.rejects(
      quizService.submitQuiz(hw.id, student1Id, [{ question_id: q1.qid, option_id: q1.correctOpt }]),
      /quá hạn/
    );
  });

  it('sửa đề sau khi đã có attempt → throw', async () => {
    const id = await setupQuiz();
    const [q1] = await getQuizIds(id);
    await quizService.submitQuiz(id, student1Id, [{ question_id: q1.qid, option_id: q1.correctOpt }]);
    assert.equal(await quizService.countQuizAttempts(id), 1);
    await assert.rejects(quizService.saveQuizQuestions(id, VALID_QUESTIONS), /Đã có học viên làm bài/);
  });

  it('lịch sử attempts của học viên', async () => {
    const id = await setupQuiz();
    const [q1, q2] = await getQuizIds(id);
    const ans = [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.wrongOpt },
    ];
    await quizService.submitQuiz(id, student1Id, ans);
    await quizService.submitQuiz(id, student1Id, ans);
    const attempts = await quizService.getStudentAttempts(id, student1Id);
    assert.equal(attempts.length, 2);
  });
});

describe('homework.service - chấm điểm tay', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('chấm vượt max_score → throw', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'B',
      created_by: 1,
      centerId: null,
      max_score: 10,
    });
    await assert.rejects(
      homeworkService.gradeHomework(hw.id, student1Id, 15, null, 1),
      /không được vượt quá 10/
    );
    // Điểm không bị ghi
    const s = await homeworkService.getStudentScore(hw.id, student1Id);
    assert.equal(s?.score ?? null, null);
  });

  it('chấm trong giới hạn → lưu điểm + feedback', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'B',
      created_by: 1,
      centerId: null,
      max_score: 10,
    });
    await homeworkService.gradeHomework(hw.id, student1Id, 8, 'Tốt', 1);
    const s = await homeworkService.getStudentScore(hw.id, student1Id);
    assert.equal(s?.score, 8);
    assert.equal(s?.feedback, 'Tốt');
  });
});

describe('homework.service - xóa cascade', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('xóa bài tập xóa sạch quiz/attempts/answers/scores/submissions/targets', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz xóa',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      target_student_ids: [student1Id],
    });
    await quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    const [q1, q2] = await getQuizIds(hw.id);
    await quizService.submitQuiz(hw.id, student1Id, [
      { question_id: q1.qid, option_id: q1.correctOpt },
      { question_id: q2.qid, option_id: q2.correctOpt },
    ]);
    await homeworkService.gradeHomework(hw.id, student1Id, 5, null, 1);
    await db
      .prepare('INSERT INTO homework_submissions (homework_id, student_id, note) VALUES (?, ?, ?)')
      .run(hw.id, student1Id, 'nộp');
    await db
      .prepare('INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, ?, ?, ?)')
      .run(hw.id, 'f', 'u', 'link');

    // Sanity: dữ liệu tồn tại trước khi xóa
    assert.ok((await count('quiz_questions', `WHERE homework_id = ${hw.id}`)) > 0);
    assert.ok((await count('quiz_attempts', `WHERE homework_id = ${hw.id}`)) > 0);

    await homeworkService.deleteHomework(hw.id);

    const w = `WHERE homework_id = ${hw.id}`;
    assert.equal(await count('homework', `WHERE id = ${hw.id}`), 0);
    assert.equal(await count('quiz_questions', w), 0);
    assert.equal(await count('quiz_options', `WHERE question_id NOT IN (SELECT id FROM quiz_questions)`), 0);
    assert.equal(await count('quiz_attempts', w), 0);
    assert.equal(await count('quiz_answers'), 0);
    assert.equal(await count('homework_scores', w), 0);
    assert.equal(await count('homework_completions', w), 0);
    assert.equal(await count('homework_submissions', w), 0);
    assert.equal(await count('homework_attachments', w), 0);
    assert.equal(await count('homework_targets', w), 0);
  });
});

describe('homework.service - publishScheduled (giờ VN)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('publish bài hẹn giờ đã đến hạn', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Hẹn',
      created_by: 1,
      centerId: null,
      status: 'scheduled',
      publish_at: '2020-01-01T00:00',
    });
    const n = await homeworkService.publishScheduled();
    assert.equal(n, 1);
    const row = (await db.prepare('SELECT status FROM homework WHERE id = ?').get(hw.id)) as {
      status: string;
    };
    assert.equal(row.status, 'published');
  });

  it('không publish bài hẹn giờ tương lai', async () => {
    await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Hẹn TL',
      created_by: 1,
      centerId: null,
      status: 'scheduled',
      publish_at: '2030-01-01T00:00',
    });
    assert.equal(await homeworkService.publishScheduled(), 0);
  });

  it('không publish bài draft', async () => {
    await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Nháp',
      created_by: 1,
      centerId: null,
      status: 'draft',
    });
    assert.equal(await homeworkService.publishScheduled(), 0);
  });
});

describe('giao riêng từng học viên (targets)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lưu đúng danh sách target', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Phụ đạo',
      created_by: 1,
      centerId: null,
      target_student_ids: [student1Id],
    });
    const targets = (await db
      .prepare('SELECT student_id FROM homework_targets WHERE homework_id = ?')
      .all(hw.id)) as {
      student_id: number;
    }[];
    assert.deepEqual(
      targets.map((t) => t.student_id),
      [student1Id]
    );
  });

  it('bài giao riêng: đúng học viên xem được, học viên khác bị chặn', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz riêng',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      target_student_ids: [student1Id],
    });
    await quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);

    // Parent của học viên trong target → xem được đề
    const qs = await parentService.getQuizForChild(parent1Id, student1Id, hw.id);
    assert.ok(Array.isArray(qs));
    assert.equal(qs.length, 2);

    // Parent của học viên ngoài target → bị chặn
    await assert.rejects(
      parentService.getQuizForChild(parent2Id, student2Id, hw.id),
      /Không tìm thấy bài quiz/
    );
  });

  it('bài giao riêng: tick hoàn thành chỉ đúng đối tượng', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài riêng',
      created_by: 1,
      centerId: null,
      target_student_ids: [student1Id],
    });
    // Ngoài target → chặn
    await assert.rejects(
      parentService.markHomeworkComplete(parent2Id, student2Id, hw.id),
      /Không tìm thấy bài tập/
    );
    // Trong target → ok
    await parentService.markHomeworkComplete(parent1Id, student1Id, hw.id);
    assert.equal(
      await count('homework_completions', `WHERE homework_id = ${hw.id} AND student_id = ${student1Id}`),
      1
    );
  });

  it('bài không giao riêng: mọi học viên trong lớp đều thấy', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz chung',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
    });
    await quizService.saveQuizQuestions(hw.id, VALID_QUESTIONS);
    assert.equal((await parentService.getQuizForChild(parent1Id, student1Id, hw.id)).length, 2);
    assert.equal((await parentService.getQuizForChild(parent2Id, student2Id, hw.id)).length, 2);
  });
});

describe('homework.service - update và reuse', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('update tiêu đề + điểm + hạn', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Cũ',
      created_by: 1,
      centerId: null,
      max_score: 10,
    });
    await homeworkService.updateHomework(hw.id, {
      title: 'Mới',
      max_score: 20,
      due_date: '2026-12-01',
      close_date: '2026-12-05',
    });
    const row = (await db
      .prepare('SELECT title, max_score, due_date, close_date FROM homework WHERE id = ?')
      .get(hw.id)) as {
      title: string;
      max_score: number;
      due_date: string;
      close_date: string;
    };
    assert.equal(row.title, 'Mới');
    assert.equal(row.max_score, 20);
    assert.equal(row.due_date, '2026-12-01');
  });

  it('update từ chối ngày sai format / ngày không có thật / close trước due', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Date test',
      created_by: 1,
      centerId: null,
      due_date: '2026-12-01',
    });
    const bad = [
      { close_date: 'abc' }, // format sai
      { close_date: '2026-02-30' }, // ngày không có thật
      { due_date: '2026-12-10', close_date: '2026-12-05' }, // close trước due
      { close_date: '2026-11-01' }, // P0-1: chỉ gửi close < due_date đang lưu trong DB
    ];
    for (const d of bad) {
      await assert.rejects(
        () => homeworkService.updateHomework(hw.id, { title: 'Date test', ...d }),
        /không hợp lệ|phải sau hạn nộp/
      );
    }
    // Luồng update hợp lệ vẫn đi qua
    await homeworkService.updateHomework(hw.id, {
      title: 'Date test',
      due_date: '2026-12-01',
      close_date: '2026-12-10',
    });
    const row = (await db.prepare('SELECT close_date FROM homework WHERE id = ?').get(hw.id)) as {
      close_date: string;
    };
    assert.equal(row.close_date, '2026-12-10');
    // P0-1: field không gửi thì giữ nguyên trong DB, không reset về null
    await homeworkService.updateHomework(hw.id, { title: 'Date test' });
    const kept = (await db
      .prepare('SELECT due_date, close_date FROM homework WHERE id = ?')
      .get(hw.id)) as { due_date: string; close_date: string };
    assert.equal(kept.due_date, '2026-12-01');
    assert.equal(kept.close_date, '2026-12-10');
  });

  it('reuse copy targets sang bài mới', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Gốc',
      created_by: 1,
      centerId: null,
      target_student_ids: [student1Id, student2Id],
    });
    const [copy] = await homeworkService.reuseHomework(hw.id, 1, null);
    assert.notEqual(copy.id, hw.id);
    const targets = (await db
      .prepare('SELECT student_id FROM homework_targets WHERE homework_id = ? ORDER BY student_id')
      .all(copy.id)) as {
      student_id: number;
    }[];
    assert.deepEqual(
      targets.map((t) => Number(t.student_id)),
      [student1Id, student2Id]
    );
  });
});

describe('homework.service - update validate rubric thuộc center (P1-1)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('chặn rubric cross-tenant, cho phép rubric cùng center', async () => {
    await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'C1'), (2, 'C2')").run();
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'R',
      created_by: 1,
      centerId: 1,
    });
    const other = await createRubric(2, 1, {
      name: 'Rubric center 2',
      criteria: [{ name: 'TC1', max_score: 10 }],
    });
    await assert.rejects(
      () => homeworkService.updateHomework(hw.id, { title: 'R', rubric_id: other.id }, 1),
      /không thuộc trung tâm/
    );
    const own = await createRubric(1, 1, {
      name: 'Rubric center 1',
      criteria: [{ name: 'TC1', max_score: 10 }],
    });
    await homeworkService.updateHomework(hw.id, { title: 'R', rubric_id: own.id }, 1);
    const row = (await db.prepare('SELECT rubric_id FROM homework WHERE id = ?').get(hw.id)) as {
      rubric_id: number;
    };
    assert.equal(Number(row.rubric_id), own.id);
  });
});

describe('validate field bắt buộc bank/rubric (P1-3)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const twoOptions = [
    { text: 'A', is_correct: true },
    { text: 'B', is_correct: false },
  ];

  it('addBankQuestion thiếu question/options → 400 (không 500)', async () => {
    await assert.rejects(
      () =>
        addBankQuestion(null, 1, {
          question: undefined as unknown as string,
          points: 1,
          options: twoOptions,
        }),
      /Câu hỏi trống/
    );
    await assert.rejects(
      () =>
        addBankQuestion(null, 1, {
          question: 'Q?',
          points: 1,
          options: undefined as unknown as { text: string; is_correct: boolean }[],
        }),
      /ít nhất 2 đáp án/
    );
  });

  it('updateBankQuestion thiếu question → 400', async () => {
    const q = await addBankQuestion(null, 1, { question: 'Q?', points: 1, options: twoOptions });
    await assert.rejects(
      () =>
        updateBankQuestion(q.id, null, {
          question: '   ',
          points: 1,
          options: twoOptions,
        }),
      /Câu hỏi trống/
    );
  });

  it('createRubric thiếu name/criteria → 400 (không 500)', async () => {
    await assert.rejects(
      () =>
        createRubric(null, 1, {
          name: undefined as unknown as string,
          criteria: [{ name: 'TC', max_score: 10 }],
        }),
      /tên rubric/
    );
    await assert.rejects(
      () =>
        createRubric(null, 1, {
          name: 'R',
          criteria: undefined as unknown as { name: string; max_score: number }[],
        }),
      /ít nhất 1 tiêu chí/
    );
  });
});

describe('validate điểm câu hỏi (P1-7)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // points: unknown để test cả giá trị sai kiểu runtime (validate ở trust boundary)
  const qWith = (points: unknown) =>
    ({
      question: 'Q?',
      points,
      options: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
      ],
    }) as unknown as Parameters<typeof quizService.validateQuizQuestions>[0][number];

  it('validateQuizQuestions: điểm âm/0/quá 1000/không phải số → 400', () => {
    for (const bad of [-1, 0, 1001, 99999, 'abc', NaN]) {
      assert.throws(
        () => quizService.validateQuizQuestions([qWith(bad)]),
        /Điểm câu 1 phải lớn hơn 0/
      );
    }
    // Thiếu điểm → mặc định 1, vẫn qua
    quizService.validateQuizQuestions([qWith(undefined)]);
    quizService.validateQuizQuestions([qWith(0.5)]);
    quizService.validateQuizQuestions([qWith(1000)]);
  });

  it('addBankQuestion: điểm âm → 400 (không clamp im lặng)', async () => {
    await assert.rejects(
      () =>
        addBankQuestion(null, 1, {
          question: 'Q?',
          points: -5,
          options: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: false },
          ],
        }),
      /Điểm câu hỏi phải lớn hơn 0/
    );
  });
});

describe('questionBank trả row trực tiếp (P1-4)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const twoOptions = [
    { text: 'A', is_correct: true },
    { text: 'B', is_correct: false },
  ];

  it('add/updateBankQuestion trả đúng row mới khi bank > 20 câu', async () => {
    for (let i = 0; i < 21; i++) {
      await addBankQuestion(null, 1, { question: `Q${i}`, points: 1, options: twoOptions });
    }
    const q = await addBankQuestion(null, 1, {
      question: 'Q mới nhất',
      points: 2,
      options: twoOptions,
    });
    assert.equal(q.question, 'Q mới nhất');
    assert.equal(q.options.length, 2);
    const u = await updateBankQuestion(q.id, null, {
      question: 'Q đã sửa',
      points: 3,
      options: twoOptions,
    });
    assert.equal(u.question, 'Q đã sửa');
    assert.equal(u.options.length, 2);
  });
});

describe('prepareCreateInput validate publish_at (P1-2)', () => {
  it('publish_at sai format → 400', () => {
    assert.throws(
      () =>
        homeworkService.prepareCreateInput({
          class_ids: [1],
          title: 'T',
          status: 'scheduled',
          publish_at: '2026/10/10 10:00',
        }),
      /Hẹn đăng không hợp lệ/
    );
    // Format đúng thì qua
    const ok = homeworkService.prepareCreateInput({
      class_ids: [1],
      title: 'T',
      status: 'scheduled',
      publish_at: '2026-10-10T10:00',
    });
    assert.equal(ok.publish_at, '2026-10-10T10:00');
  });
});

describe('homework.service - publish quiz phải có câu hỏi (P0-3)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createEmptyQuiz(): Promise<number> {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz rỗng',
      created_by: 1,
      centerId: null,
      status: 'draft',
      kind: 'quiz',
    });
    return hw.id;
  }

  it('setHomeworkStatus từ chối đăng quiz 0 câu hỏi', async () => {
    const id = await createEmptyQuiz();
    await assert.rejects(
      () => homeworkService.setHomeworkStatus(id, 'published', null),
      /chưa có câu hỏi/
    );
    // Thêm câu hỏi rồi đăng được
    await quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    await homeworkService.setHomeworkStatus(id, 'published', null);
    const row = (await db.prepare('SELECT status FROM homework WHERE id = ?').get(id)) as {
      status: string;
    };
    assert.equal(row.status, 'published');
  });

  it('updateHomework đổi status sang published cũng check câu hỏi', async () => {
    const id = await createEmptyQuiz();
    await assert.rejects(
      () => homeworkService.updateHomework(id, { title: 'Quiz rỗng', status: 'published' }),
      /chưa có câu hỏi/
    );
  });

  it('reuseHomework copy đủ câu hỏi (1 transaction, không còn quiz 0 câu)', async () => {
    const id = await createEmptyQuiz();
    await quizService.saveQuizQuestions(id, VALID_QUESTIONS);
    const [copy] = await homeworkService.reuseHomework(id, 1, null);
    assert.equal(await quizService.countQuizQuestions(copy.id), VALID_QUESTIONS.length);
    // Bản copy là draft nhưng đủ câu hỏi nên đăng được ngay
    await homeworkService.setHomeworkStatus(copy.id, 'published', null);
  });

  it('createHomeworkBatch không emit homework.created (route emit sau khi lưu đề)', async () => {
    let emitted = 0;
    const off = eventBus.on('homework.created', () => {
      emitted++;
    });
    try {
      await homeworkService.createHomeworkBatch({
        class_ids: [classId],
        title: 'E',
        created_by: 1,
        centerId: null,
      });
    } finally {
      off();
    }
    assert.equal(emitted, 0);
  });

  it('reuseHomework emit homework.created sau khi copy xong', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'E2',
      created_by: 1,
      centerId: null,
    });
    let emitted = 0;
    const off = eventBus.on('homework.created', () => {
      emitted++;
    });
    try {
      await homeworkService.reuseHomework(hw.id, 1, null);
    } finally {
      off();
    }
    assert.equal(emitted, 1);
  });
});

describe('quiz.service - đồng bộ max_score (P1-5)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const HALF_QUESTIONS = [
    {
      question: 'Câu nửa điểm 1',
      points: 0.5,
      options: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
      ],
    },
    {
      question: 'Câu nửa điểm 2',
      points: 1.5,
      options: [
        { text: 'A', is_correct: false },
        { text: 'B', is_correct: true },
      ],
    },
  ];

  async function createQuiz(): Promise<number> {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz điểm lẻ',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      max_score: null,
    });
    return hw.id;
  }

  async function maxScoreOf(id: number): Promise<number> {
    const row = (await db.prepare('SELECT max_score FROM homework WHERE id = ?').get(id)) as {
      max_score: number;
    };
    return Number(row.max_score);
  }

  it('saveQuizQuestions cập nhật max_score = tổng điểm, giữ điểm lẻ 0.5', async () => {
    const id = await createQuiz();
    await quizService.saveQuizQuestions(id, HALF_QUESTIONS);
    assert.equal(await maxScoreOf(id), 2); // 0.5 + 1.5, không bị round
    // Sửa đề lần 2 → max_score đồng bộ lại theo đề mới
    await quizService.saveQuizQuestions(id, [HALF_QUESTIONS[0]]);
    assert.equal(await maxScoreOf(id), 0.5);
  });

  it('importFromBank cộng dồn và không làm tròn điểm lẻ', async () => {
    const id = await createQuiz();
    await quizService.saveQuizQuestions(id, [HALF_QUESTIONS[0]]); // 0.5
    const { addBankQuestion, importFromBank } = await import('./questionBank.service');
    const bq = await addBankQuestion(null, 1, {
      question: 'Câu bank nửa điểm',
      points: 1.5,
      options: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
      ],
    });
    await importFromBank(id, [bq.id], null);
    assert.equal(await maxScoreOf(id), 2); // 0.5 + 1.5, không Math.round
  });
});

describe('questionBank.service - chặn import sai loại bài (P1-7)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('import vào bài thường → 400, không đụng max_score', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài thường',
      created_by: 1,
      centerId: null,
      kind: 'homework',
      max_score: 10,
    });
    const { addBankQuestion, importFromBank } = await import('./questionBank.service');
    const bq = await addBankQuestion(null, 1, {
      question: 'Câu bank',
      points: 2,
      options: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
      ],
    });
    await assert.rejects(() => importFromBank(hw.id, [bq.id], null), /Chỉ được import câu hỏi vào bài quiz/);
    const row = (await db.prepare('SELECT max_score FROM homework WHERE id = ?').get(hw.id)) as {
      max_score: number;
    };
    assert.equal(Number(row.max_score), 10); // max_score giữ nguyên
  });
});

describe('parent.service - nộp bài idempotent (P1-6)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('2 POST liên tiếp chỉ tạo 1 bản nộp, trả về cùng id', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài nộp',
      created_by: 1,
      centerId: null,
      kind: 'homework',
      status: 'published',
    });
    const data = { file_url: null, file_name: null, note: 'làm xong' };
    const first = await parentService.submitHomework(parent1Id, student1Id, hw.id, data);
    const second = await parentService.submitHomework(parent1Id, student1Id, hw.id, data);
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.id, first.id);
    const rows = (await db
      .prepare('SELECT id FROM homework_submissions WHERE homework_id = ? AND student_id = ?')
      .all(hw.id, student1Id)) as { id: number }[];
    assert.equal(rows.length, 1); // không tạo bản ghi thứ 2
  });
});

describe('homework.service - listHomework JOIN/GROUP BY (P1-4)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('completed_count / student_count / question_count đúng sau khi gộp query', async () => {
    // Bài thường: giao riêng 1 HV + 1 lượt hoàn thành
    const [hw1] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài có target',
      created_by: 1,
      centerId: null,
      status: 'published',
      target_student_ids: [student1Id],
    });
    await db
      .prepare("INSERT INTO homework_completions (homework_id, student_id, completed_by) VALUES (?, ?, 'teacher')")
      .run(hw1.id, student1Id);
    // Quiz 2 câu, giao cả lớp (không target)
    const [hw2] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz cả lớp',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      status: 'published',
    });
    await quizService.saveQuizQuestions(hw2.id, [
      {
        question: 'Q1',
        points: 1,
        options: [
          { text: 'A', is_correct: true },
          { text: 'B', is_correct: false },
        ],
      },
      {
        question: 'Q2',
        points: 2,
        options: [
          { text: 'A', is_correct: false },
          { text: 'B', is_correct: true },
        ],
      },
    ]);
    const list = await homeworkService.listHomework(
      { centerId: null, role: 'admin', teacherId: null, ownOnly: false },
      {},
      { limit: 10 }
    );
    const r1 = list.data.find((r) => r.id === hw1.id)!;
    const r2 = list.data.find((r) => r.id === hw2.id)!;
    assert.equal(Number(r1.completed_count), 1);
    assert.equal(Number(r1.student_count), 1); // có target riêng → đếm target
    assert.equal(Number(r1.question_count), 0);
    assert.equal(Number(r2.completed_count), 0);
    assert.equal(Number(r2.student_count), 2); // không target → đếm cả lớp
    assert.equal(Number(r2.question_count), 2);
  });

  it('getQuizForStudent không lộ is_correct; getStudentAttempts gom đáp án đúng', async () => {
    const [hw] = await homeworkService.createHomeworkBatch({
      class_ids: [classId],
      title: 'Quiz N+1',
      created_by: 1,
      centerId: null,
      kind: 'quiz',
      status: 'published',
    });
    await quizService.saveQuizQuestions(hw.id, [
      {
        question: 'Q1',
        points: 1,
        options: [
          { text: 'A', is_correct: true },
          { text: 'B', is_correct: false },
        ],
      },
      {
        question: 'Q2',
        points: 1,
        options: [
          { text: 'A', is_correct: false },
          { text: 'B', is_correct: true },
        ],
      },
    ]);
    const forStudent = await quizService.getQuizForStudent(hw.id);
    assert.equal(forStudent.length, 2);
    assert.equal(forStudent[0].options.length, 2);
    assert.ok(!('is_correct' in forStudent[0].options[0]), 'học viên không được thấy is_correct');
    const forStaff = await quizService.getQuizForStaff(hw.id);
    assert.equal(typeof forStaff[0].options[0].is_correct, 'boolean');
    // Nộp bài rồi xem lịch sử
    const ids = await getQuizIds(hw.id);
    await quizService.submitQuiz(hw.id, student1Id, [
      { question_id: ids[0].qid, option_id: ids[0].correctOpt },
      { question_id: ids[1].qid, option_id: ids[1].wrongOpt },
    ]);
    const attempts = await quizService.getStudentAttempts(hw.id, student1Id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].answers.length, 2);
    assert.deepEqual(
      attempts[0].answers.map((a) => Boolean(a.correct)),
      [true, false]
    );
    const review = await quizService.getAttemptReview(attempts[0].id, student1Id);
    assert.equal(review.length, 2);
    assert.equal(review[0].options.filter((o) => o.chosen).length, 1);
  });
});

describe('questionBank.service - sửa câu hỏi', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('updateBankQuestion thay câu hỏi + toàn bộ đáp án trong 1 lần', async () => {
    const { addBankQuestion, updateBankQuestion, listBankQuestions } = await import(
      './questionBank.service'
    );
    const bq = await addBankQuestion(null, 1, {
      question: 'Câu cũ',
      points: 1,
      options: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
      ],
    });
    const updated = await updateBankQuestion(bq.id, null, {
      question: 'Câu mới',
      points: 2,
      options: [
        { text: 'X', is_correct: false },
        { text: 'Y', is_correct: true },
        { text: 'Z', is_correct: false },
      ],
    });
    assert.equal(updated.question, 'Câu mới');
    assert.equal(updated.points, 2);
    assert.deepEqual(
      updated.options.map((o) => [o.text, o.is_correct]),
      [
        ['X', false],
        ['Y', true],
        ['Z', false],
      ]
    );
    // Không để lại đáp án cũ: tổng số đáp án đúng bằng số mới
    const all = await listBankQuestions(null);
    assert.equal(all.data.find((q) => q.id === bq.id)!.options.length, 3);
  });

  it('updateBankQuestion validate trước khi ghi, id lạ → 404', async () => {
    const { updateBankQuestion } = await import('./questionBank.service');
    await assert.rejects(
      () =>
        updateBankQuestion(999999, null, {
          question: 'x',
          points: 1,
          options: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: false },
          ],
        }),
      /Không tìm thấy câu hỏi/
    );
  });
});
