import { describe, it, expect } from 'vitest';
import {
  isValidHttpUrl,
  isQuizQuestionInvalid,
  quickDate,
  validateLocalUpload,
  pruneSelected,
  editAttachmentsPayload,
} from './HomeworkFormModal';
import type { QuizQuestionForm } from './homework.api';
import { todayVN } from '../../shared/types';

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

describe('isQuizQuestionInvalid - điểm số', () => {
  const base: QuizQuestionForm = {
    question: '2 + 2 = ?',
    points: 1,
    qtype: 'single',
    options: [
      { text: '3', is_correct: false },
      { text: '4', is_correct: true },
    ],
  };
  it('điểm 0 hoặc âm là không hợp lệ (không ép im lặng thành 1)', () => {
    expect(isQuizQuestionInvalid({ ...base, points: 0 })).toBe(true);
    expect(isQuizQuestionInvalid({ ...base, points: -2 })).toBe(true);
  });
  it('điểm quá 1000 là không hợp lệ (giới hạn server)', () => {
    expect(isQuizQuestionInvalid({ ...base, points: 1001 })).toBe(true);
    expect(isQuizQuestionInvalid({ ...base, points: 1000 })).toBe(false);
  });
  it('điểm lẻ 0.5 hợp lệ', () => {
    expect(isQuizQuestionInvalid({ ...base, points: 0.5 })).toBe(false);
  });
});

describe('quickDate', () => {
  it('today khớp todayVN()', () => {
    expect(quickDate('today')).toBe(todayVN());
  });
  it('tomorrow/nextweek cộng đúng ngày theo lịch VN', () => {
    const plus = (base: string, n: number) => {
      const [y, m, d] = base.split('-').map(Number);
      const dt = new Date(y, m - 1, d + n);
      const p = (x: number) => String(x).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
    };
    const t = todayVN();
    expect(quickDate('tomorrow')).toBe(plus(t, 1));
    expect(quickDate('nextweek')).toBe(plus(t, 7));
  });
  it('weekend ra đúng Chủ nhật và sau hôm nay', () => {
    const w = quickDate('weekend');
    const [y, m, d] = w.split('-').map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(0);
    expect(w > todayVN()).toBe(true);
  });
});

describe('validateLocalUpload', () => {
  it('chấp nhận file đúng định dạng trong giới hạn 10MB', () => {
    expect(validateLocalUpload('bai-nghe.mp3', 5 * 1024 * 1024)).toBe(null);
    expect(validateLocalUpload('Anh Dai Dien.PNG', 1024)).toBe(null);
    expect(validateLocalUpload('tai-lieu.docx', 1024)).toBe(null);
  });
  it('từ chối đuôi lạ', () => {
    expect(validateLocalUpload('virus.exe', 1024)).toBe('type');
    expect(validateLocalUpload('khong-duoi', 1024)).toBe('type');
  });
  it('từ chối file quá 10MB', () => {
    expect(validateLocalUpload('lon.mp4', 10 * 1024 * 1024 + 1)).toBe('size');
    expect(validateLocalUpload('lon.mp4', 10 * 1024 * 1024)).toBe(null);
  });
});

describe('pruneSelected', () => {
  it('bỏ học viên không còn thuộc lớp đang chọn', () => {
    expect(pruneSelected([1, 2, 3], [{ id: 2 }, { id: 3 }, { id: 4 }])).toEqual([2, 3]);
    expect(pruneSelected([1, 2], [])).toEqual([]);
  });
  it('không đổi gì thì giữ nguyên tham chiếu (không re-render thừa)', () => {
    const sel = [2];
    expect(pruneSelected(sel, [{ id: 2 }])).toBe(sel);
  });
});

describe('editAttachmentsPayload', () => {
  const list = [{ id: 1, name: 'a', url: '/uploads/hw_a.pdf', kind: 'file' }];
  it('chưa tải xong / tải lỗi → undefined (server giữ đính kèm cũ, không gửi [])', () => {
    expect(editAttachmentsPayload('loading', [])).toBeUndefined();
    expect(editAttachmentsPayload('error', [])).toBeUndefined();
  });
  it('đã tải xong → gửi danh sách (bỏ id)', () => {
    expect(editAttachmentsPayload('ok', list)).toEqual([
      { name: 'a', url: '/uploads/hw_a.pdf', kind: 'file' },
    ]);
    expect(editAttachmentsPayload('ok', [])).toEqual([]);
  });
});
