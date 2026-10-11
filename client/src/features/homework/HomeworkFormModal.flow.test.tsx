// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import i18n from '../../i18n';
import { $, $$, byText, cleanup, click, mockFetch, renderPage, type, type Call } from '../../test-utils';
import { HomeworkFormModal } from './HomeworkFormModal';
import type { HomeworkItem } from '../../shared/types';
import type { ClassItem } from '../classes/classes.api';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'homework', ...o }));
const ph = (k: string, o?: Record<string, unknown>) => $<HTMLInputElement>(`[placeholder="${t(k, o)}"]`);
const classes = [
  { id: 1, name: 'A1' },
  { id: 2, name: 'B2' },
] as ClassItem[];
const file = { id: 7, name: 'de.pdf', url: '/uploads/hw_1.pdf', kind: 'file' };

let calls: Call[];
let saved = 0;
beforeEach(() => {
  saved = 0;
  calls = mockFetch({
    'GET /homework/rubrics/list': [],
    'POST /homework': { count: 1 },
    'GET /homework/5': { id: 5, attachments: [file] },
    'PUT /homework/5': { ok: true },
  });
});
afterEach(cleanup);

const open = (initial: HomeworkItem | null = null) =>
  renderPage(
    <HomeworkFormModal classes={classes} initial={initial} onClose={() => {}} onSaved={() => saved++} />
  );
const sent = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

async function fillBasics() {
  await click(byText('A1'));
  await type(ph('form.titlePhHw'), 'Ôn tập Unit 5');
}

describe('HomeworkFormModal: link gõ dở khi lưu (B4-1)', () => {
  it('URL hợp lệ chưa bấm "+ Thêm" -> tự thêm khi giao bài (tên trống lấy URL)', async () => {
    await open();
    await fillBasics();
    await type(ph('form.attUrlPh'), ' https://example.com/a.mp3 ');
    await click($('button[type="submit"]'));
    const body = sent('POST', '/homework')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      class_ids: [1],
      title: 'Ôn tập Unit 5',
      kind: 'homework',
      status: 'published',
    });
    expect(body.attachments).toEqual([
      { name: 'https://example.com/a.mp3', url: 'https://example.com/a.mp3', kind: 'link' },
    ]);
    expect(saved).toBe(1);
  });

  it('URL sai / có tên mà thiếu URL -> chặn lưu, báo lỗi inline, focus ô link', async () => {
    await open();
    await fillBasics();
    await type(ph('form.attNamePh'), 'Audio');
    await click($('button[type="submit"]'));
    expect(sent('POST', '/homework')).toBeUndefined();
    expect(document.body.textContent).toContain(t('form.errors.attRequired'));
    await type(ph('form.attUrlPh'), 'example.com/a.mp3');
    await click($('button[type="submit"]'));
    expect(sent('POST', '/homework')).toBeUndefined();
    expect(document.body.textContent).toContain(t('form.errors.attUrlInvalid'));
    expect(document.activeElement).toBe(ph('form.attUrlPh'));
    // B5-3: lỗi gắn vào đúng ô URL (aria-invalid + aria-describedby trỏ tới dòng lỗi), ô tên không bị đánh dấu
    const url = ph('form.attUrlPh')!;
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(url.getAttribute('aria-describedby')!)!.textContent).toBe(
      t('form.errors.attUrlInvalid')
    );
    expect(ph('form.attNamePh')!.hasAttribute('aria-invalid')).toBe(false);
  });

  it('"+ Thêm" vẫn bắt nhập tên; thêm xong ô nhập được xóa', async () => {
    await open();
    await type(ph('form.attUrlPh'), 'https://x.vn/a');
    await click(byText(t('form.addAttachment')));
    expect(document.body.textContent).toContain(t('form.errors.attRequired'));
    await type(ph('form.attNamePh'), 'Tài liệu');
    await click(byText(t('form.addAttachment')));
    expect($$('.att-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Tài liệu')]);
    expect(ph('form.attUrlPh')!.value).toBe('');
  });

  it('sửa bài: giữ file cũ + thêm link gõ dở; đóng khi còn link gõ dở thì hỏi xác nhận', async () => {
    const initial = { id: 5, title: 'Bài cũ', kind: 'homework', status: 'published' } as HomeworkItem;
    await open(initial);
    expect($$('.att-row')).toHaveLength(1);
    await type(ph('form.attNamePh'), 'Video');
    await type(ph('form.attUrlPh'), 'https://youtu.be/x');
    await click(byText(t('actions.cancel', { ns: 'common' })));
    expect(document.body.textContent).toContain(t('form.discardTitle'));
    await click($$('[role="dialog"]').at(-1)!.querySelector('.modal-actions .btn'));
    await click(byText(t('form.saveChanges')));
    expect(sent('PUT', '/homework/5')!.body).toMatchObject({
      title: 'Bài cũ',
      status: 'published',
      attachments: [
        { name: 'de.pdf', url: file.url, kind: 'file' },
        { name: 'Video', url: 'https://youtu.be/x', kind: 'link' },
      ],
    });
  });
});

describe('HomeworkFormModal: validate + quiz', () => {
  it('thiếu lớp + tiêu đề -> lỗi inline, không gọi API', async () => {
    await open();
    await click($('button[type="submit"]'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(document.body.textContent).toContain(t('form.errors.classRequired'));
    expect(document.body.textContent).toContain(t('form.errors.titleRequired'));
  });

  it('quiz: câu hỏi chưa đủ -> chặn; đủ đáp án + đáp án đúng -> gửi questions + max_attempts mặc định 3', async () => {
    await open();
    await click(byText(t('form.kindQuiz')));
    await click(byText('A1'));
    await type(ph('form.titlePhQuiz'), 'Quiz 1');
    await click($('button[type="submit"]'));
    expect(sent('POST', '/homework')).toBeUndefined();
    expect(document.body.textContent).toContain(t('form.errors.quizInvalid', { count: 1 }));

    await type(ph('form.questionPh', { n: 1 }), '2+2=?');
    await type(ph('form.optionPh', { letter: 'A' }), '4');
    await type(ph('form.optionPh', { letter: 'B' }), '5');
    await click($$('.quiz-correct')[0]);
    await click($('button[type="submit"]'));
    const body = sent('POST', '/homework')!.body as {
      questions: unknown[];
      max_attempts: number;
      kind: string;
    };
    expect(body.kind).toBe('quiz');
    expect(body.max_attempts).toBe(3);
    expect(body.questions).toEqual([
      expect.objectContaining({
        question: '2+2=?',
        options: [
          expect.objectContaining({ text: '4', is_correct: true }),
          expect.objectContaining({ text: '5', is_correct: false }),
        ],
      }),
    ]);
  });
});
