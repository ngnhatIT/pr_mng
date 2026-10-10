/**
 * Unit test cho FIX chịu tải: submitQuiz chuyển từ N query chấm điểm
 * (mỗi câu hỏi 1 query SELECT ... FROM quiz_options WHERE id = ? AND question_id = ?)
 * sang 1 query batch duy nhất WHERE question_id IN (...), chấm trong memory.
 *
 * Không cần PostgreSQL thật: mock db.prepare để bắt SQL, kiểm tra
 * (1) quiz_options chỉ bị query đúng 1 lần với mệnh đề IN,
 * (2) điểm chấm đúng và semantics giữ nguyên
 *     (đáp án đúng nhưng thuộc câu khác vẫn bị chấm sai).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
// Pool chỉ kết nối khi có query thật; test này mock hết nên URL giả là đủ.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import * as quizService from './quiz.service';

const origPrepare = db.prepare;
const origTransaction = db.transaction;

let captured: string[];
let lastBatchArgs: unknown[];

const QUESTIONS = [
  { id: 101, points: 1 },
  { id: 102, points: 2 },
  { id: 103, points: 3 },
];

// Mỗi câu 2 đáp án: opt 2 đúng cho câu 101, opt 3 đúng cho câu 102, opt 6 đúng cho câu 103
const OPTIONS = [
  { id: 1, question_id: 101, is_correct: 0 },
  { id: 2, question_id: 101, is_correct: 1 },
  { id: 3, question_id: 102, is_correct: 1 },
  { id: 4, question_id: 102, is_correct: 0 },
  { id: 5, question_id: 103, is_correct: 0 },
  { id: 6, question_id: 103, is_correct: 1 },
];

function stmtFor(sql: string) {
  return {
    get: async (..._args: unknown[]) => {
      if (sql.startsWith('SELECT close_date')) return { close_date: null }; // chưa quá hạn
      if (sql.includes('COUNT(*)')) return { c: 0 }; // lượt làm đầu tiên
      if (sql.includes('FOR UPDATE')) return { id: 1 }; // P1-13: lock row homework
      throw new Error('unexpected get: ' + sql);
    },
    all: async (...args: unknown[]) => {
      if (sql.startsWith('SELECT id, points FROM quiz_questions')) return QUESTIONS;
      if (sql.includes('FROM quiz_options')) {
        lastBatchArgs = args;
        return OPTIONS;
      }
      throw new Error('unexpected all: ' + sql);
    },
    run: async (..._args: unknown[]) => ({ lastInsertRowid: 7, changes: 1 }),
  };
}

beforeEach(() => {
  captured = [];
  lastBatchArgs = [];
  (db as { prepare: unknown }).prepare = (sql: string) => {
    captured.push(sql);
    return stmtFor(sql);
  };
  (db as { transaction: unknown }).transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ prepare: db.prepare });
});

after(() => {
  db.prepare = origPrepare;
  db.transaction = origTransaction;
});

const optionQueries = () => captured.filter((s) => s.includes('FROM quiz_options'));

describe('submitQuiz — 1 query batch thay N+1', () => {
  it('chấm đúng điểm, quiz_options chỉ query 1 lần với IN', async () => {
    const r = await quizService.submitQuiz(1, 10, [
      { question_id: 101, option_id: 2 }, // đúng: +1
      { question_id: 102, option_id: 4 }, // sai
      { question_id: 103, option_id: 6 }, // đúng: +3
    ]);
    assert.equal(r.score, 4);
    assert.equal(r.max_score, 6);
    assert.equal(r.attempt_id, 7);
    assert.equal(r.attempt_no, 1);

    assert.equal(optionQueries().length, 1, 'phải chỉ query quiz_options đúng 1 lần');
    assert.ok(optionQueries()[0].includes('IN ('), 'query batch phải dùng WHERE question_id IN (...)');
    assert.deepEqual(lastBatchArgs, [101, 102, 103], 'IN phải truyền đủ id câu hỏi');
  });

  it('đáp án đúng của câu khác vẫn bị chấm sai (giữ semantics cũ)', async () => {
    // opt 2 là đáp án ĐÚNG của câu 101, nhưng nộp cho câu 102
    const r = await quizService.submitQuiz(1, 10, [{ question_id: 102, option_id: 2 }]);
    assert.equal(r.score, 0);
    assert.equal(optionQueries().length, 1);
  });

  it('câu bỏ trống không bị chấm điểm', async () => {
    const r = await quizService.submitQuiz(1, 10, [{ question_id: 101, option_id: 2 }]);
    assert.equal(r.score, 1);
    assert.equal(r.max_score, 6);
  });
});
