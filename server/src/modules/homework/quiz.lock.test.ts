/**
 * Test P1-13: saveQuizQuestions / importFromBank / submitQuiz phải lock row
 * homework (SELECT ... FOR UPDATE) TRƯỚC KHI check attempts / ghi dữ liệu —
 * hết race TOCTOU. Dùng mock-db (không cần PostgreSQL): assert thứ tự gọi SQL
 * trong transaction qua flag `locked`.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL = 'postgres://localhost:5432/unused';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import type { RunResult } from '../../db/pg-compat';
import { saveQuizQuestions, submitQuiz } from './quiz.service';
import { importFromBank } from './questionBank.service';

let restore: (() => void) | null = null;
/** true sau khi câu SELECT ... FOR UPDATE chạy trong transaction hiện tại. */
let locked = false;
/** Số attempt mà mock trả về cho COUNT. */
let attemptCount = 0;

function okRun(rowid?: number): RunResult {
  return { changes: 1, lastInsertRowid: rowid };
}

const VALID_Q = [
  {
    question: '2 + 2 = ?',
    points: 1,
    options: [
      { text: '3', is_correct: false },
      { text: '4', is_correct: true },
    ],
  },
];

/** Route lock — PHẢI đặt trước mọi route 'FROM homework WHERE id = ?' khác
 * (chuỗi ngắn là tiền tố của chuỗi dài). */
function lockRoute(): MockRoute {
  return {
    match: 'FROM homework WHERE id = ? FOR UPDATE',
    get: () => {
      locked = true;
      return { id: 1 };
    },
  };
}

/** Route COUNT attempts — assert đã lock trước khi check (P1-13). */
function attemptsRoute(): MockRoute {
  return {
    match: 'FROM quiz_attempts WHERE homework_id = ?',
    get: () => {
      assert.ok(locked, 'check attempts phải chạy SAU khi lock row homework');
      return { c: attemptCount };
    },
  };
}

beforeEach(() => {
  locked = false;
  attemptCount = 0;
  if (restore) restore();
});

after(() => restore?.());

describe('P1-13 saveQuizQuestions lock trước khi check attempts', () => {
  function setup(): void {
    restore = installMockDb([
      lockRoute(),
      attemptsRoute(),
      { match: 'FROM quiz_questions WHERE homework_id = ?', all: () => [] },
      { match: 'DELETE FROM quiz_questions', run: () => okRun() },
      { match: 'INSERT INTO quiz_questions', run: () => okRun(11) },
      { match: 'INSERT INTO quiz_options', run: () => okRun() },
      { match: 'UPDATE homework SET max_score', run: () => okRun() },
    ]);
  }

  it('lock rồi mới check attempts → không attempt thì lưu đề ok', async () => {
    setup();
    await saveQuizQuestions(1, VALID_Q);
    assert.ok(locked);
  });

  it('đã có attempt → throw sau khi lock (không xóa đề)', async () => {
    setup();
    attemptCount = 1;
    await assert.rejects(() => saveQuizQuestions(1, VALID_Q), /Đã có học viên làm bài/);
    assert.ok(locked);
  });
});

describe('P1-13 importFromBank lock trước khi check attempts', () => {
  function setup(): void {
    restore = installMockDb([
      lockRoute(),
      { match: 'SELECT kind FROM homework', get: () => ({ kind: 'quiz' }) },
      attemptsRoute(),
      {
        match: 'FROM question_bank WHERE id IN',
        all: () => [{ id: 5, question: 'Câu bank', points: 2 }],
      },
      {
        match: 'FROM question_bank_options',
        all: () => [
          { question_id: 5, text: 'A', is_correct: 1 },
          { question_id: 5, text: 'B', is_correct: 0 },
        ],
      },
      { match: 'COALESCE(MAX(position)', get: () => ({ m: -1 }) },
      { match: 'INSERT INTO quiz_questions', run: () => okRun(12) },
      { match: 'INSERT INTO quiz_options', run: () => okRun() },
      { match: 'SELECT points FROM quiz_questions', all: () => [{ points: 2 }] },
      { match: 'UPDATE homework SET max_score', run: () => okRun() },
    ]);
  }

  it('lock rồi mới check attempts → import ok', async () => {
    setup();
    const n = await importFromBank(1, [5], null);
    assert.equal(n, 1);
    assert.ok(locked);
  });

  it('đã có attempt → throw sau khi lock', async () => {
    setup();
    attemptCount = 2;
    await assert.rejects(() => importFromBank(1, [5], null), /Đã có học viên làm bài/);
    assert.ok(locked);
  });
});

describe('P1-13 submitQuiz lock row homework khi tạo attempt', () => {
  function setup(): void {
    restore = installMockDb([
      lockRoute(),
      { match: 'SELECT close_date FROM homework', get: () => ({ close_date: null }) },
      {
        match: 'SELECT id, points FROM quiz_questions',
        all: () => [{ id: 21, points: 2 }],
      },
      {
        match: 'FROM quiz_options WHERE question_id IN',
        all: () => [
          { id: 31, question_id: 21, is_correct: 1 },
          { id: 32, question_id: 21, is_correct: 0 },
        ],
      },
      { match: 'FROM quiz_attempts WHERE homework_id = ? AND student_id = ?', get: () => ({ c: 0 }) },
      {
        match: 'INSERT INTO quiz_attempts',
        run: () => {
          assert.ok(locked, 'tạo attempt phải chạy SAU khi lock row homework');
          return okRun(41);
        },
      },
      { match: 'INSERT INTO quiz_answers', run: () => okRun() },
      { match: 'INSERT INTO homework_scores', run: () => okRun() },
      { match: 'INSERT INTO homework_completions', run: () => okRun() },
    ]);
  }

  it('nộp bài serialize qua lock, chấm đúng điểm', async () => {
    setup();
    const r = await submitQuiz(1, 1001, [{ question_id: 21, option_id: 31 }]);
    assert.equal(r.score, 2);
    assert.equal(r.max_score, 2);
    assert.ok(locked);
  });
});
