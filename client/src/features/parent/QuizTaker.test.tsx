// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '../../i18n';
import { QuizTaker } from './QuizTaker';
import { parentApi } from './parent.api';
import type { HomeworkItem } from '../../shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

const attempt = (id: number) => ({
  id,
  score: 1,
  max_score: 2,
  submitted_at: '2026-10-01 10:00',
  answers: [],
});
vi.spyOn(parentApi, 'getQuiz').mockResolvedValue([
  { id: 1, qtype: 'single', question: 'Q1', points: 1, options: [{ id: 11, text: 'A' }] },
]);
const getAttempts = vi.spyOn(parentApi, 'getQuizAttempts');

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function render(max_attempts: number | null, used: number) {
  getAttempts.mockResolvedValue(Array.from({ length: used }, (_, i) => attempt(i + 1)));
  const hw = {
    id: 7,
    title: 'Quiz',
    kind: 'quiz',
    max_attempts,
    close_date: null,
  } as unknown as HomeworkItem;
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(<QuizTaker homework={hw} studentId={1} onClose={() => {}} onDone={() => {}} reviewOnly />);
  });
}

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, { ns: 'parent', ...o });
const byText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text));

async function retakeAndSubmit(left: number) {
  await act(async () => byText(t('quiz.retakeN', { count: left }))!.click());
  act(() => (document.querySelector('.quiz-take-opt') as HTMLButtonElement).click());
  const nav = document.querySelectorAll('.quiz-nav button');
  act(() => (nav[nav.length - 1] as HTMLButtonElement).click());
  return document.querySelector('.confirm-text')?.textContent;
}

describe('QuizTaker lượt làm (B3-2)', () => {
  it('xem lại -> "Làm lại (còn N lượt)" -> làm bài; xác nhận nộp báo số lượt còn sau lượt này', async () => {
    await render(3, 1);
    expect(await retakeAndSubmit(2)).toBe(t('quiz.confirmSubmitN', { count: 1 }));
  });

  it('lượt cuối: xác nhận không hứa làm lại', async () => {
    await render(2, 1);
    expect(await retakeAndSubmit(1)).toBe(t('quiz.confirmSubmitLast'));
  });

  it('hết lượt: không có nút làm lại', async () => {
    await render(2, 2);
    expect(document.querySelectorAll('.list-item')).toHaveLength(2);
    expect(byText(t('quiz.retry'))).toBeUndefined();
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('('))).toBe(
      false
    );
  });
});
