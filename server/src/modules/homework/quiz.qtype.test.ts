/**
 * Unit test cho đa loại câu hỏi (qtype): single/multiple/truefalse/essay.
 * - validateQuizQuestions theo loại (dùng chung quiz + bank qua helper)
 * - Quy tắc chấm: multiple phải khớp TOÀN BỘ (không điểm từng phần),
 *   essay không chấm tự động (chờ chấm tay)
 * - submitQuiz lưu nhiều dòng đáp án cho multiple, answer_text cho essay
 *
 * Không cần PostgreSQL thật: mock db.prepare như quiz.batch.test.ts.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import * as quizService from './quiz.service';
import {
  normalizeQtype,
  normalizeDifficulty,
  validateQuestionOptions,
  gradeQuestion,
} from './homework.helpers';

const origPrepare = db.prepare;
const origTransaction = db.transaction;

const opt = (text: string, is_correct: boolean) => ({ text, is_correct });

describe('validate theo loại câu hỏi', () => {
  it('single: 2 đáp án đúng → 400', () => {
    assert.throws(
      () => validateQuestionOptions('single', [opt('A', true), opt('B', true)], 'Câu 1'),
      /đúng 1 đáp án đúng/
    );
  });
  it('single: 0 đáp án đúng → 400', () => {
    assert.throws(
      () => validateQuestionOptions('single', [opt('A', false), opt('B', false)], 'Câu 1'),
      /đúng 1 đáp án đúng/
    );
  });
  it('multiple: nhiều đáp án đúng OK, 0 đáp án đúng → 400', () => {
    const ok = validateQuestionOptions(
      'multiple',
      [opt('A', true), opt('B', true), opt('C', false)],
      'Câu 1'
    );
    assert.equal(ok.length, 3);
    assert.throws(
      () => validateQuestionOptions('multiple', [opt('A', false), opt('B', false)], 'Câu 1'),
      /chưa chọn đáp án đúng/
    );
  });
  it('truefalse: phải đúng 2 đáp án', () => {
    assert.throws(
      () =>
        validateQuestionOptions(
          'truefalse',
          [opt('Đúng', true), opt('Sai', false), opt('C', false)],
          'Câu 1'
        ),
      /đúng 2 đáp án/
    );
    const ok = validateQuestionOptions('truefalse', [opt('Đúng', true), opt('Sai', false)], 'Câu 1');
    assert.equal(ok.length, 2);
  });
  it('essay: bỏ qua options, không yêu cầu đáp án đúng', () => {
    assert.deepEqual(validateQuestionOptions('essay', undefined, 'Câu 1'), []);
    assert.deepEqual(validateQuestionOptions('essay', [opt('A', false)], 'Câu 1'), []);
  });
  it('qtype lạ → 400; thiếu → single (tương thích cũ)', () => {
    assert.throws(() => normalizeQtype('radio'), /không hợp lệ/);
    assert.equal(normalizeQtype(undefined), 'single');
    assert.equal(normalizeQtype('multiple'), 'multiple');
  });
  it('difficulty lạ → 400; thiếu → medium', () => {
    assert.throws(() => normalizeDifficulty('extreme'), /không hợp lệ/);
    assert.equal(normalizeDifficulty(undefined), 'medium');
  });
  it('validateQuizQuestions: essay không cần options, multiple 2 đáp án đúng OK', () => {
    const out = quizService.validateQuizQuestions([
      { question: 'Tự luận', points: 2, qtype: 'essay', options: [] },
      {
        question: 'Chọn nhiều',
        points: 1,
        qtype: 'multiple',
        options: [opt('A', true), opt('B', true), opt('C', false)],
      },
      {
        question: 'Đúng sai',
        points: 1,
        qtype: 'truefalse',
        options: [opt('Đúng', true), opt('Sai', false)],
      },
    ]);
    assert.equal(out[0].qtype, 'essay');
    assert.deepEqual(out[0].options, []);
    assert.equal(out[1].qtype, 'multiple');
  });
});

describe('gradeQuestion — quy tắc chấm', () => {
  it('single/truefalse: khớp đáp án đúng → true', () => {
    assert.equal(gradeQuestion('single', [5], [5]), true);
    assert.equal(gradeQuestion('single', [6], [5]), false);
    assert.equal(gradeQuestion('truefalse', [5], [5]), true);
  });
  it('multiple: khớp TOÀN BỘ mới full điểm, thiếu/thừa → 0 (không điểm từng phần)', () => {
    assert.equal(gradeQuestion('multiple', [1, 2], [1, 2]), true);
    assert.equal(gradeQuestion('multiple', [1], [1, 2]), false); // thiếu 1 đáp án đúng
    assert.equal(gradeQuestion('multiple', [1, 2, 3], [1, 2]), false); // chọn thừa đáp án sai
    assert.equal(gradeQuestion('multiple', [], [1, 2]), false);
  });
  it('essay: không chấm tự động → null (chờ chấm tay)', () => {
    assert.equal(gradeQuestion('essay', [], []), null);
  });
});

/* ------------------------- submitQuiz với mock DB ------------------------- */

// Quiz: câu 201 single (đáp án đúng 11), câu 202 multiple (đáp án đúng 21, 22),
// câu 203 essay.
const QUESTIONS = [
  { id: 201, qtype: 'single', points: 2 },
  { id: 202, qtype: 'multiple', points: 3 },
  { id: 203, qtype: 'essay', points: 5 },
];
const OPTIONS = [
  { id: 11, question_id: 201, is_correct: 1 },
  { id: 12, question_id: 201, is_correct: 0 },
  { id: 21, question_id: 202, is_correct: 1 },
  { id: 22, question_id: 202, is_correct: 1 },
  { id: 23, question_id: 202, is_correct: 0 },
];

let answerInserts: { question_id: number; option_id: number | null; answer_text: string | null }[];

function stmtFor(sql: string) {
  return {
    get: async () => {
      if (sql.startsWith('SELECT close_date')) return { close_date: null };
      if (sql.includes('COUNT(*)')) return { c: 0 };
      if (sql.includes('FOR UPDATE')) return { id: 1 };
      throw new Error('unexpected get: ' + sql);
    },
    all: async () => {
      if (sql.includes('FROM quiz_questions')) return QUESTIONS;
      if (sql.includes('FROM quiz_options')) return OPTIONS;
      throw new Error('unexpected all: ' + sql);
    },
    run: async (...args: unknown[]) => {
      if (sql.startsWith('INSERT INTO quiz_answers')) {
        answerInserts.push({
          question_id: args[1] as number,
          option_id: (args[2] as number | null) ?? null,
          answer_text: (args[3] as string | null) ?? null,
        });
      }
      return { lastInsertRowid: 9, changes: 1 };
    },
  };
}

beforeEach(() => {
  answerInserts = [];
  (db as { prepare: unknown }).prepare = (sql: string) => stmtFor(sql);
  (db as { transaction: unknown }).transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ prepare: db.prepare });
});

after(() => {
  db.prepare = origPrepare;
  db.transaction = origTransaction;
});

describe('submitQuiz — đa loại câu hỏi', () => {
  it('multiple khớp toàn bộ + single đúng → full 5đ; essay 0đ tạm (chờ chấm tay)', async () => {
    const r = await quizService.submitQuiz(1, 10, [
      { question_id: 201, option_id: 11 },
      { question_id: 202, option_ids: [21, 22] },
      { question_id: 203, answer_text: 'Bài làm tự luận của em' },
    ]);
    assert.equal(r.score, 5); // 2 + 3 + 0
    assert.equal(r.max_score, 10);
    // multiple lưu 2 dòng đáp án; essay lưu 1 dòng answer_text
    const q202 = answerInserts.filter((a) => a.question_id === 202);
    assert.deepEqual(q202.map((a) => a.option_id).sort(), [21, 22]);
    const q203 = answerInserts.filter((a) => a.question_id === 203);
    assert.equal(q203.length, 1);
    assert.equal(q203[0].answer_text, 'Bài làm tự luận của em');
    assert.equal(q203[0].option_id, null);
  });

  it('multiple thiếu 1 đáp án đúng → 0đ câu đó (không điểm từng phần)', async () => {
    const r = await quizService.submitQuiz(1, 10, [
      { question_id: 201, option_id: 11 },
      { question_id: 202, option_ids: [21] }, // thiếu 22
    ]);
    assert.equal(r.score, 2);
  });

  it('multiple chọn thừa đáp án sai → 0đ câu đó', async () => {
    const r = await quizService.submitQuiz(1, 10, [{ question_id: 202, option_ids: [21, 22, 23] }]);
    assert.equal(r.score, 0);
  });

  it('đáp án của câu khác bị lọc (không 500, không tính điểm)', async () => {
    const r = await quizService.submitQuiz(1, 10, [{ question_id: 201, option_ids: [21] }]);
    assert.equal(r.score, 0);
    assert.deepEqual(
      answerInserts.filter((a) => a.question_id === 201),
      [{ question_id: 201, option_id: null, answer_text: null }]
    );
  });

  it('shape cũ {question_id, option_id} vẫn chấm đúng (tương thích)', async () => {
    const r = await quizService.submitQuiz(1, 10, [{ question_id: 201, option_id: 11 }]);
    assert.equal(r.score, 2);
  });
});
