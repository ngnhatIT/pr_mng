// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import i18n from '../../i18n';
import { $, $$, byText, cleanup, click, json, mockFetch, renderRoutes, type Call } from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { ChildDetail } from './ChildDetail';
import type { HomeworkItem } from '../../shared/types';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'parent', ...o }));
const quiz = (id: number, o: Partial<HomeworkItem>) =>
  ({
    id,
    title: `Quiz ${id}`,
    kind: 'quiz',
    completed: true,
    due_date: null,
    close_date: null,
    ...o,
  }) as HomeworkItem;

function overview(homework: HomeworkItem[]) {
  return {
    student: { id: 3, name: 'Nguyễn An', code: 'HV003' },
    classes: [{ id: 1, name: 'A1', schedule: 'T2 18:00', teacher_name: 'Cô Lan', room_name: 'P1' }],
    upcomingSessions: [{ id: 9, date: '2099-01-01', topic: 'Unit 6', class_name: 'A1' }],
    attendance: { present: 8, absent: 1, late: 1, total: 10, rate: 80 },
    invoices: [
      {
        id: 4,
        amount: 1_500_000,
        paid: 500_000,
        due_date: '2026-10-01',
        status: 'partial',
        class_name: 'A1',
        note: null,
      },
    ],
    grades: [
      {
        id: 1,
        student_id: 3,
        class_id: 1,
        title: 'Giữa kỳ',
        score: 8,
        max_score: 10,
        created_at: '2026-09-01',
      },
    ],
    homework,
    credits: { total: 0, used: 0, available: 0 },
  };
}

let calls: Call[];
const render = (tab = '') =>
  renderRoutes([{ path: '/parent/children/:id', element: <ChildDetail /> }], `/parent/children/3${tab}`);
beforeEach(() => setAuth('ptok', { id: 9, username: '0901', role: 'parent', name: 'P' }));
afterEach(cleanup);

describe('ChildDetail', () => {
  it('hiện tên con, đặt tiêu đề tab (B4-5) và chuyển qua các tab', async () => {
    calls = mockFetch({ 'GET /parent/children/3/overview': overview([]) });
    await render();
    expect($('h1')!.textContent).toBe('Nguyễn An');
    expect(document.title).toBe('Nguyễn An - EduCenter Pro');
    expect(document.body.textContent).toContain('Unit 6');
    await click(byText(t('child.tabs.attendance')));
    expect(document.body.textContent).toContain('80');
    await click(byText(t('child.tabs.tuition')));
    expect(document.body.textContent).toMatch(/1\.000\.000/); // còn nợ = 1.5tr − 0.5tr
    await click(byText(t('child.tabs.grades')));
    expect(document.body.textContent).toContain('Giữa kỳ');
  });

  it('lỗi mạng -> Thử lại; NOT_FOUND -> "không tìm thấy"', async () => {
    mockFetch({ 'GET /parent/children/3/overview': json(500, { error: 'x' }) });
    await render();
    expect(document.body.textContent).toContain(String(i18n.t('actions.retry', { ns: 'common' })));
    cleanup();
    setAuth('ptok', { id: 9, username: '0901', role: 'parent', name: 'P' });
    mockFetch({ 'GET /parent/children/3/overview': json(404, { error: 'x', code: 'NOT_FOUND' }) });
    await render();
    expect(document.body.textContent).toContain(t('child.notFoundTitle'));
  });
});

describe('ChildDetail: tab bài tập, nút làm lại quiz (B3-2)', () => {
  const card = (title: string) =>
    $$('.hw-item').find((e) => e.querySelector('.hw-title')!.textContent!.includes(title))!;
  const buttons = (title: string) =>
    [...card(title).querySelectorAll('.hw-actions button')].map((b) => b.textContent);

  it('còn lượt / không giới hạn / hết lượt / quá hạn chót / server chưa trả attempts_used', async () => {
    mockFetch({
      'GET /parent/children/3/overview': overview([
        quiz(1, { max_attempts: 3, attempts_used: 1 }),
        quiz(2, { max_attempts: null }),
        quiz(3, { max_attempts: 2, attempts_used: 2 }),
        quiz(4, { max_attempts: null, close_date: '2000-01-01T00:00:00' }),
        quiz(5, { max_attempts: 3 }),
        quiz(6, { completed: false }),
      ]),
    });
    await render('?tab=homework');
    const review = t('child.homework.reviewQuiz');
    expect(buttons('Quiz 1')).toEqual([t('quiz.retakeN', { count: 2 }), review]);
    expect(buttons('Quiz 2')).toEqual([t('quiz.retry'), review]);
    expect(buttons('Quiz 3')).toEqual([review]);
    expect(buttons('Quiz 4')).toEqual([review]);
    expect(buttons('Quiz 5')).toEqual([review]);
    expect(buttons('Quiz 6')).toEqual([t('child.homework.takeQuiz')]);
  });

  it('đánh dấu xong bài thường -> POST complete kèm student_id rồi tải lại', async () => {
    calls = mockFetch({
      'GET /parent/children/3/overview': overview([
        { id: 7, title: 'Bài 7', kind: 'homework', completed: false, due_date: '2099-01-01' } as HomeworkItem,
      ]),
      'POST /parent/homework/7/complete': { ok: true },
    });
    await render('?tab=homework');
    await click(card('Bài 7').querySelector('.hw-check'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/parent/homework/7/complete',
      body: { student_id: 3 },
    });
    expect(calls.filter((c) => c.path === '/parent/children/3/overview')).toHaveLength(2);
    expect($('.toast-success')!.textContent).toBe(t('child.homework.markedDone'));
  });
});
