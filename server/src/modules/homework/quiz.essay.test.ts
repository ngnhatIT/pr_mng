/**
 * Unit test cho YC2 — chấm tự luận quiz theo rubric.
 * - Validate trust boundary: kind quiz, quiz có rubric, câu essay, tiêu chí thuộc
 *   rubric, điểm 0..max từng tiêu chí, học viên đã làm quiz
 * - Tính tổng: điểm tự động (lượt cao nhất) + điểm tay → giữ thập phân, chặn vượt max_score
 * - Idempotent: chấm lại upsert ghi đè, tổng tính lại đúng
 *
 * Không cần PostgreSQL thật: mock db.prepare như quiz.batch.test.ts.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
// Pool chỉ kết nối khi có query thật; test này mock hết nên dùng URL giả local.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://localhost:5432/educenter_test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import * as quizService from './quiz.service';

const origPrepare = db.prepare;
const origTransaction = db.transaction;

/** Fixture: quiz có rubric 2 tiêu chí (Nội dung 6đ, Trình bày 4đ). */
const HW = { class_id: 5, kind: 'quiz', rubric_id: 7, max_score: 20 };
const HW_NO_RUBRIC = { class_id: 5, kind: 'quiz', rubric_id: null, max_score: 20 };
const HW_NORMAL = { class_id: 5, kind: 'homework', rubric_id: 7, max_score: 10 };
const RUBRIC_ROW = { id: 7, name: 'Tự luận', center_id: null };
const CRITERIA = [
  { id: 71, name: 'Nội dung', max_score: 6 },
  { id: 72, name: 'Trình bày', max_score: 4 },
];

interface Cfg {
  hw?: { class_id: number; kind: string; rubric_id: number | null; max_score: number } | null;
  qtype?: string;
  criteria?: { id: number; name: string; max_score: number }[];
  attempts?: number; // số lượt làm (0 = chưa làm)
  maxAttemptScore?: number; // điểm tự động cao nhất
  scoresRow?: { score: number | null; feedback: string | null } | null;
  essayPoints?: number; // điểm của câu essay (mặc định 10 = tổng rubric)
}

let cfg: Cfg;
let runs: { sql: string; args: unknown[] }[];
/** Giả lập bảng quiz_essay_scores: upsert ghi đè theo criterion_id, SUM tính lại thật. */
let essayTable: Map<number, number>;

function stmtFor(sql: string) {
  return {
    get: async (..._args: unknown[]) => {
      if (sql.includes('FROM homework WHERE id = ?') && !sql.includes('FOR UPDATE'))
        return cfg.hw === null ? undefined : (cfg.hw ?? HW);
      if (sql.includes('FROM quiz_questions WHERE id = ?'))
        return cfg.qtype === 'missing' ? undefined : { id: 201, qtype: cfg.qtype ?? 'essay' };
      if (sql.includes('FROM enrollments')) return { '1': 1 }; // học viên thuộc lớp
      if (sql.includes('FROM rubrics WHERE id = ?')) return RUBRIC_ROW;
      if (sql.includes('FROM quiz_attempts') && sql.includes('COUNT(*)')) return { c: cfg.attempts ?? 1 };
      if (sql.includes('FOR UPDATE')) return { id: 1 };
      if (sql.includes('COALESCE(MAX(score), 0)')) return { m: cfg.maxAttemptScore ?? 6 };
      if (sql.includes('COALESCE(SUM(score), 0)'))
        return { s: [...essayTable.values()].reduce((a, b) => a + b, 0) };
      if (sql.includes('FROM homework_scores WHERE homework_id = ? AND student_id = ?'))
        return cfg.scoresRow ?? undefined;
      if (sql.includes('FROM quiz_attempts') && sql.includes('LIMIT 1'))
        return { id: 9, submitted_at: '2026-10-10 10:00:00' };
      throw new Error('unexpected get: ' + sql);
    },
    all: async (...args: unknown[]) => {
      if (sql.includes('FROM rubric_criteria')) return cfg.criteria ?? CRITERIA;
      // HW-5/HW-8: SUM theo câu, CHỈ tiêu chí của rubric hiện tại (args: hw, student, ...criterion ids)
      if (sql.includes('FROM quiz_essay_scores es JOIN quiz_questions')) {
        const ids = new Set(args.slice(2).map(Number));
        const sum = [...essayTable.entries()].filter(([cid]) => ids.has(cid)).reduce((a, [, v]) => a + v, 0);
        return essayTable.size ? [{ question_id: 201, points: cfg.essayPoints ?? 10, s: sum }] : [];
      }
      if (sql.includes("qtype = 'essay'") && sql.includes('SELECT id as question_id'))
        return [{ question_id: 201, question: 'Tự luận 1', points: 10 }];
      if (sql.includes('FROM quiz_answers')) return [{ question_id: 201, answer_text: 'Bài làm mẫu' }];
      if (sql.includes('FROM quiz_essay_scores') && sql.includes('SELECT question_id')) return [];
      throw new Error('unexpected all: ' + sql);
    },
    run: async (...args: unknown[]) => {
      runs.push({ sql, args });
      // INSERT quiz_essay_scores: args = (homework_id, student_id, question_id, criterion_id, score, graded_by)
      if (sql.includes('INTO quiz_essay_scores')) essayTable.set(Number(args[3]), Number(args[4]));
      return { lastInsertRowid: 1, changes: 1 };
    },
  };
}

beforeEach(() => {
  cfg = {};
  runs = [];
  essayTable = new Map();
  (db as { prepare: unknown }).prepare = (sql: string) => stmtFor(sql);
  (db as { transaction: unknown }).transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ prepare: db.prepare });
});

after(() => {
  db.prepare = origPrepare;
  db.transaction = origTransaction;
});

const grade = () =>
  quizService.gradeQuizEssay(
    1,
    10,
    201,
    [
      { criterion_id: 71, score: 5 },
      { criterion_id: 72, score: 3 },
    ],
    null,
    99
  );

describe('gradeQuizEssay — validate trust boundary', () => {
  it('bài không phải quiz → 400', async () => {
    cfg.hw = HW_NORMAL;
    await assert.rejects(() => grade(), /chỉ áp dụng cho quiz/);
  });
  it('quiz chưa gắn rubric → 400', async () => {
    cfg.hw = HW_NO_RUBRIC;
    await assert.rejects(() => grade(), /chưa gắn rubric/);
  });
  it('câu hỏi không tồn tại → 404', async () => {
    cfg.qtype = 'missing';
    await assert.rejects(() => grade(), /Không tìm thấy câu hỏi/);
  });
  it('câu trắc nghiệm → 400', async () => {
    cfg.qtype = 'single';
    await assert.rejects(() => grade(), /Chỉ câu tự luận/);
  });
  it('tiêu chí không thuộc rubric → 400 (chống ghi bừa)', async () => {
    await assert.rejects(
      () => quizService.gradeQuizEssay(1, 10, 201, [{ criterion_id: 999, score: 5 }], null, 99),
      /không thuộc rubric/
    );
  });
  it('điểm âm → 400', async () => {
    await assert.rejects(
      () => quizService.gradeQuizEssay(1, 10, 201, [{ criterion_id: 71, score: -1 }], null, 99),
      /không hợp lệ/
    );
  });
  it('điểm vượt trần tiêu chí → 400', async () => {
    await assert.rejects(
      () => quizService.gradeQuizEssay(1, 10, 201, [{ criterion_id: 71, score: 6.5 }], null, 99),
      /không được vượt quá 6/
    );
  });
  it('tiêu chí lặp → 400', async () => {
    await assert.rejects(
      () =>
        quizService.gradeQuizEssay(
          1,
          10,
          201,
          [
            { criterion_id: 71, score: 5 },
            { criterion_id: 71, score: 4 },
          ],
          null,
          99
        ),
      /nhập trùng/
    );
  });
  it('danh sách tiêu chí rỗng → 400', async () => {
    await assert.rejects(() => quizService.gradeQuizEssay(1, 10, 201, [], null, 99), /Chưa nhập điểm/);
  });
  it('học viên chưa làm quiz → 400', async () => {
    cfg.attempts = 0;
    await assert.rejects(() => grade(), /chưa làm quiz/);
  });
  it('học viên không thuộc lớp → 400', async () => {
    // ghi đè mock enrollments: không thuộc lớp, không trong targets
    const prev = db.prepare;
    (db as { prepare: unknown }).prepare = (sql: string) => {
      const st = (prev as (s: string) => ReturnType<typeof stmtFor>)(sql);
      if (sql.includes('FROM enrollments') || sql.includes('FROM homework_targets'))
        return { ...st, get: async () => undefined };
      return st;
    };
    await assert.rejects(() => grade(), /không thuộc lớp/);
  });
});

describe('gradeQuizEssay — tính tổng điểm', () => {
  it('tổng = điểm tự động cao nhất + điểm tay, giữ thập phân', async () => {
    cfg.maxAttemptScore = 6.5;
    const r = await quizService.gradeQuizEssay(
      1,
      10,
      201,
      [
        { criterion_id: 71, score: 5.5 },
        { criterion_id: 72, score: 2 },
      ],
      null,
      99
    );
    assert.equal(r.auto_score, 6.5);
    assert.equal(r.essay_score, 7.5);
    assert.equal(r.total, 14); // 6.5 + 7.5, không làm tròn sai
    const scoreRun = runs.find((x) => x.sql.includes('INTO homework_scores'));
    assert.ok(scoreRun, 'phải upsert homework_scores');
    assert.equal(scoreRun.args[2], 14);
  });
  it('chấm lại: upsert ghi đè từng tiêu chí, tổng tính lại đúng', async () => {
    // Đã chấm trước: Nội dung 4 + Trình bày 4 = 8 → chấm lại Nội dung 5, Trình bày 3
    essayTable.set(71, 4);
    essayTable.set(72, 4);
    const r = await grade();
    assert.equal(r.essay_score, 8); // 5 + 3 sau khi upsert ghi đè
    assert.equal(r.total, 14);
    const upserts = runs.filter((x) => x.sql.includes('INTO quiz_essay_scores'));
    assert.equal(upserts.length, 2, 'upsert từng dòng tiêu chí');
    assert.ok(upserts[0].sql.includes('ON CONFLICT'), 'phải dùng ON CONFLICT (idempotent)');
  });
  it('HW-5: điểm essay quy đổi theo điểm câu (câu 2đ, rubric 10đ: 5+3 → 1.6)', async () => {
    cfg.essayPoints = 2;
    cfg.maxAttemptScore = 8;
    const r = await grade();
    assert.equal(r.essay_score, 1.6);
    assert.equal(r.total, 9.6);
  });
  it('HW-8: điểm tiêu chí của rubric cũ không cộng vào tổng', async () => {
    essayTable.set(999, 8); // tiêu chí rubric cũ còn sót trong quiz_essay_scores
    const r = await grade();
    assert.equal(r.essay_score, 8); // chỉ 71 + 72 = 5 + 3
  });
  it('tổng vượt max_score của quiz → 400 (chống gõ nhầm)', async () => {
    cfg.maxAttemptScore = 15;
    await assert.rejects(() => grade(), /không được vượt quá 20/);
  });
  it('feedback null → giữ nhận xét cũ (không ghi đè bằng NULL)', async () => {
    await grade();
    const scoreRun = runs.find((x) => x.sql.includes('INTO homework_scores'));
    assert.ok(scoreRun && !scoreRun.sql.includes('feedback = excluded.feedback'));
  });
  it('feedback có giá trị → ghi đè', async () => {
    await quizService.gradeQuizEssay(1, 10, 201, [{ criterion_id: 71, score: 5 }], 'Làm tốt', 99);
    const scoreRun = runs.find((x) => x.sql.includes('INTO homework_scores'));
    assert.ok(scoreRun && scoreRun.sql.includes('feedback = excluded.feedback'));
    assert.equal(scoreRun.args[3], 'Làm tốt');
  });
});

describe('getEssayGrading — dữ liệu form chấm', () => {
  it('trả rubric + bài làm + điểm đã chấm + tổng', async () => {
    cfg.scoresRow = { score: 14, feedback: 'Khá' };
    const d = await quizService.getEssayGrading(1, 10);
    assert.equal(d.rubric.id, 7);
    assert.equal(d.questions.length, 1);
    assert.equal(d.questions[0].answer_text, 'Bài làm mẫu');
    assert.equal(d.auto_score, 6);
    assert.equal(d.total_score, 14);
    assert.equal(d.feedback, 'Khá');
  });
  it('quiz chưa gắn rubric → 400', async () => {
    cfg.hw = HW_NO_RUBRIC;
    await assert.rejects(() => quizService.getEssayGrading(1, 10), /chưa gắn rubric/);
  });
  it('không phải quiz → 400', async () => {
    cfg.hw = HW_NORMAL;
    await assert.rejects(() => quizService.getEssayGrading(1, 10), /chỉ áp dụng cho quiz/);
  });
});
