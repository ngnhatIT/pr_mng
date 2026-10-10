/**
 * Unit test cho FIX P1-4: các hàm đọc quiz dùng 1 query batch duy nhất cho đáp án
 * thay vì 1 query/câu hỏi (hoặc /lượt làm). Mock db.prepare để đếm số query.
 *
 * Không cần PostgreSQL thật: pool chỉ kết nối khi có query thật; test này mock hết.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import * as quizService from './quiz.service';

const origPrepare = db.prepare;

let captured: string[];

const QUESTIONS = [
  { id: 101, question: 'Q1', points: 1 },
  { id: 102, question: 'Q2', points: 2 },
  { id: 103, question: 'Q3', points: 3 },
];
const OPTIONS = [
  { id: 1, question_id: 101, text: 'A', is_correct: 0 },
  { id: 2, question_id: 101, text: 'B', is_correct: 1 },
  { id: 3, question_id: 102, text: 'A', is_correct: 1 },
  { id: 4, question_id: 102, text: 'B', is_correct: 0 },
  { id: 5, question_id: 103, text: 'A', is_correct: 0 },
  { id: 6, question_id: 103, text: 'B', is_correct: 1 },
];
const ATTEMPTS = [
  { id: 11, score: 3, max_score: 6, submitted_at: '2026-01-01' },
  { id: 12, score: 4, max_score: 6, submitted_at: '2026-01-02' },
];
const ANSWERS = [
  { attempt_id: 11, question_id: 101, option_id: 2, correct: 1 },
  { attempt_id: 11, question_id: 102, option_id: 4, correct: 0 },
  { attempt_id: 12, question_id: 101, option_id: 2, correct: 1 },
];

function stmtFor(sql: string) {
  return {
    get: async () => {
      if (sql.includes('FROM quiz_attempts WHERE id')) return { homework_id: 1, student_id: 10 };
      throw new Error('unexpected get: ' + sql);
    },
    all: async () => {
      if (sql.includes('FROM quiz_questions')) return QUESTIONS;
      if (sql.includes('FROM quiz_options')) return OPTIONS;
      if (sql.includes('FROM quiz_attempts WHERE homework_id')) return ATTEMPTS;
      if (sql.includes('FROM quiz_answers qa')) return ANSWERS;
      if (sql.includes('FROM quiz_answers WHERE attempt_id')) return ANSWERS.filter((a) => a.attempt_id === 11);
      // YC2: điểm chấm tay câu essay trong getAttemptReview — 1 query GROUP BY duy nhất
      if (sql.includes('FROM quiz_essay_scores')) return [];
      throw new Error('unexpected all: ' + sql);
    },
    run: async () => ({ lastInsertRowid: 1, changes: 1 }),
  };
}

beforeEach(() => {
  captured = [];
  (db as { prepare: unknown }).prepare = (sql: string) => {
    captured.push(sql);
    return stmtFor(sql);
  };
});

after(() => {
  db.prepare = origPrepare;
});

const countQ = (frag: string) => captured.filter((s) => s.includes(frag)).length;

describe('quiz.service - batch query chống N+1 (P1-4)', () => {
  it('getQuizForStudent: 3 câu hỏi → quiz_options chỉ 1 query IN', async () => {
    const qs = await quizService.getQuizForStudent(1);
    assert.equal(qs.length, 3);
    assert.equal(qs[0].options.length, 2);
    assert.equal(countQ('FROM quiz_options'), 1);
    assert.ok(captured.find((s) => s.includes('FROM quiz_options'))!.includes('IN ('));
  });

  it('getQuizForStaff: 3 câu hỏi → quiz_options chỉ 1 query', async () => {
    const qs = await quizService.getQuizForStaff(1);
    assert.equal(qs.length, 3);
    assert.equal(countQ('FROM quiz_options'), 1);
  });

  it('getStudentAttempts: 2 lượt làm → quiz_answers chỉ 1 query IN', async () => {
    const atts = await quizService.getStudentAttempts(1, 10);
    assert.equal(atts.length, 2);
    assert.equal(atts[0].answers.length, 2);
    assert.equal(atts[1].answers.length, 1);
    assert.equal(countQ('FROM quiz_answers'), 1);
    assert.ok(captured.find((s) => s.includes('FROM quiz_answers'))!.includes('IN ('));
  });

  it('getAttemptReview: 3 câu hỏi → quiz_options chỉ 1 query', async () => {
    const review = await quizService.getAttemptReview(11, 10);
    assert.equal(review.length, 3);
    assert.equal(countQ('FROM quiz_options'), 1);
  });
});
