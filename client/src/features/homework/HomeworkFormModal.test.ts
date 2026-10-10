import { describe, it, expect } from 'vitest';
import { isValidHttpUrl, isQuizQuestionInvalid } from './HomeworkFormModal';
import type { QuizQuestionForm } from './homework.api';

describe('isValidHttpUrl', () => {
  it('chấp nhận http/https', () => {
    expect(isValidHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });
  it('từ chối protocol khác và chuỗi rác', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('không phải url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});

describe('isQuizQuestionInvalid', () => {
  const base: QuizQuestionForm = {
    question: '2 + 2 = ?',
    points: 1,
    qtype: 'single',
    options: [
      { text: '3', is_correct: false },
      { text: '4', is_correct: true },
    ],
  };
  it('câu hợp lệ', () => {
    expect(isQuizQuestionInvalid(base)).toBe(false);
  });
  it('thiếu nội dung câu hỏi', () => {
    expect(isQuizQuestionInvalid({ ...base, question: '  ' })).toBe(true);
  });
  it('single thiếu đáp án đúng', () => {
    expect(
      isQuizQuestionInvalid({
        ...base,
        options: [
          { text: '3', is_correct: false },
          { text: '4', is_correct: false },
        ],
      })
    ).toBe(true);
  });
  it('multiple cần ít nhất 1 đáp án đúng', () => {
    expect(
      isQuizQuestionInvalid({
        ...base,
        qtype: 'multiple',
        options: [
          { text: '3', is_correct: false },
          { text: '4', is_correct: false },
        ],
      })
    ).toBe(true);
    expect(isQuizQuestionInvalid({ ...base, qtype: 'multiple' })).toBe(false);
  });
  it('truefalse phải đủ 2 đáp án Đúng/Sai', () => {
    expect(
      isQuizQuestionInvalid({
        ...base,
        qtype: 'truefalse',
        options: [{ text: 'Đúng', is_correct: true }],
      })
    ).toBe(true);
  });
  it('essay không cần đáp án', () => {
    expect(isQuizQuestionInvalid({ ...base, qtype: 'essay', options: [] })).toBe(false);
  });
});
