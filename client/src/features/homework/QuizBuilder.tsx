import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  homeworkApi,
  blankOptions,
  type BankQuestion,
  type QType,
  type QuizQuestionForm,
} from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { isQuizQuestionInvalid, type HwFieldErrors } from './homeworkForm';

/** State + thao tác của bộ soạn đề quiz (tách khỏi HomeworkFormModal, state vẫn do form cha giữ qua hook). */
export function useQuizBuilder(initial: HomeworkItem | null, clear: HwFieldErrors['clear']) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [questions, setQuestions] = useState<QuizQuestionForm[]>([
    {
      question: '',
      points: 1,
      qtype: 'single',
      options: blankOptions(),
    },
  ]);
  const [quizLocked, setQuizLocked] = useState(false); // đã có người làm → không sửa đề
  // P0-1: đánh dấu đã sửa đề quiz (không bật khi tải đề cũ lúc mở modal sửa)
  const [quizEdited, setQuizEdited] = useState(false);
  // Chế độ sửa quiz: đề cũ + lượt làm phải tải xong ('ok') mới cho sửa đề.
  // Đang tải → khóa builder (fetch về muộn không ghi đè cái đang gõ); lỗi → khóa + báo lỗi.
  const [quizLoad, setQuizLoad] = useState<'loading' | 'ok' | 'error'>(
    initial?.kind === 'quiz' ? 'loading' : 'ok'
  );
  const builderLocked = quizLocked || quizLoad !== 'ok';
  // P1-2: ref từng khối câu hỏi để cuộn + focus tới câu lỗi đầu tiên
  const qBlockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [showBankPicker, setShowBankPicker] = useState(false);

  // Khi sửa quiz: tải đề cũ (kèm đáp án đúng) + kiểm tra đã có lượt làm chưa
  useEffect(() => {
    if (!initial || initial.kind !== 'quiz') return;
    let cancelled = false;
    Promise.all([homeworkApi.getQuizEdit(initial.id), homeworkApi.getQuizAttempts(initial.id)])
      .then(([qs, attempts]) => {
        if (cancelled) return;
        if (qs.length > 0) {
          setQuestions(
            qs.map((q) => ({
              question: q.question,
              points: q.points,
              qtype: (q.qtype ?? 'single') as QType,
              options: q.options.map((o) => ({ text: o.text, is_correct: !!o.is_correct })),
            }))
          );
        }
        setQuizLocked(attempts.length > 0);
        setQuizLoad('ok');
      })
      .catch(() => {
        if (!cancelled) setQuizLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  /** Mọi thao tác sửa đề quiz đi qua đây để đánh dấu đã sửa (dirty-check P0-1).
   * Tải đề cũ lúc mở modal sửa dùng setQuestions trực tiếp nên không bị đánh dấu. */
  const editQuestions = (updater: (qs: QuizQuestionForm[]) => QuizQuestionForm[]) => {
    setQuizEdited(true);
    setQuestions(updater);
  };
  const importBankQuestions = (bank: BankQuestion[]) => {
    const mapped = bank.map((b) => ({
      question: b.question,
      points: b.points,
      qtype: b.qtype as QType,
      options: b.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
    }));
    editQuestions((qs) => {
      const onlyEmpty = qs.length === 1 && !qs[0].question.trim();
      return onlyEmpty ? mapped : [...qs, ...mapped];
    });
    toast(t('form.toast.bankImported', { count: mapped.length }), 'success');
  };
  const addQuestion = () =>
    editQuestions((q) => [
      ...q,
      {
        question: '',
        points: 1,
        qtype: 'single' as QType,
        options: blankOptions(),
      },
    ]);
  const updateQuestion = (i: number, patch: Partial<QuizQuestionForm>) => {
    clear('quiz');
    editQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  /** Đổi loại câu hỏi: truefalse tự tạo sẵn 2 đáp án Đúng/Sai, essay ẩn đáp án. */
  const changeQuestionType = (qi: number, next: QType) => {
    clear('quiz');
    editQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== qi) return q;
        if (next === 'truefalse') {
          return {
            ...q,
            qtype: next,
            options: [
              { text: t('bank.trueLabel'), is_correct: true },
              { text: t('bank.falseLabel'), is_correct: false },
            ],
          };
        }
        if (next === 'essay') return { ...q, qtype: next, options: [] };
        const options = q.options.length >= 2 ? q.options : blankOptions();
        // Chuyển về single: đảm bảo chỉ 1 đáp án đúng
        const fixed =
          next === 'single' && options.filter((o) => o.is_correct).length !== 1
            ? options.map((o, k) => ({ ...o, is_correct: k === 0 }))
            : options;
        return { ...q, qtype: next, options: fixed };
      })
    );
  };
  const addOption = (qi: number) =>
    editQuestions((qs) =>
      qs.map((q, j) => (j === qi ? { ...q, options: [...q.options, { text: '', is_correct: false }] } : q))
    );
  const updateOption = (qi: number, oi: number, patch: Partial<{ text: string; is_correct: boolean }>) =>
    editQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== qi) return q;
        const qtype = q.qtype ?? 'single';
        return {
          ...q,
          // single/truefalse: 1 đáp án đúng nên bỏ chọn các đáp án khác;
          // multiple: bật/tắt từng đáp án, giữ nguyên các đáp án còn lại
          options: q.options.map((o, k) =>
            k === oi
              ? { ...o, ...patch }
              : patch.is_correct && (qtype === 'single' || qtype === 'truefalse')
                ? { ...o, is_correct: false }
                : o
          ),
        };
      })
    );
  const removeOption = (qi: number, oi: number) =>
    editQuestions((qs) =>
      qs.map((q, j) => (j === qi ? { ...q, options: q.options.filter((_, k) => k !== oi) } : q))
    );

  const quizTotal = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);
  /** Validate builder theo loại câu hỏi (server validate lại từ B1). */
  const quizInvalidCount = questions.filter(isQuizQuestionInvalid).length;
  // Lọc đáp án trống trước khi gửi (server cũng validate lại)
  const cleanedQuestions: QuizQuestionForm[] = questions.map((q) => ({
    ...q,
    qtype: q.qtype ?? 'single',
    options: q.qtype === 'essay' ? [] : q.options.filter((o) => o.text.trim()),
  }));

  /** P1-2: cuộn + focus tới câu hỏi lỗi đầu tiên (pattern QuizTaker). */
  const focusFirstInvalid = () => {
    const firstBad = questions.findIndex(isQuizQuestionInvalid);
    if (firstBad < 0) return;
    requestAnimationFrame(() => {
      const el = qBlockRefs.current[firstBad];
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    });
  };

  return {
    questions,
    quizLocked,
    quizEdited,
    quizLoad,
    builderLocked,
    qBlockRefs,
    showBankPicker,
    setShowBankPicker,
    editQuestions,
    importBankQuestions,
    addQuestion,
    updateQuestion,
    changeQuestionType,
    addOption,
    updateOption,
    removeOption,
    quizTotal,
    quizInvalidCount,
    cleanedQuestions,
    focusFirstInvalid,
  };
}

export type QuizBuilderState = ReturnType<typeof useQuizBuilder>;

/** Bộ soạn câu hỏi quiz (danh sách câu hỏi, loại, điểm, đáp án, thêm từ ngân hàng). */
export function QuizBuilder({ quiz, error }: { quiz: QuizBuilderState; error?: string }) {
  const { t } = useTranslation(['homework', 'common']);
  const {
    questions,
    quizLocked,
    quizLoad,
    builderLocked,
    qBlockRefs,
    quizTotal,
    editQuestions,
    updateQuestion,
    changeQuestionType,
    updateOption,
    removeOption,
    addOption,
    addQuestion,
    setShowBankPicker,
  } = quiz;
  return (
    <Field label={t('form.quizQuestions', { count: questions.length, total: quizTotal })} error={error} group>
      {quizLoad === 'error' && (
        <div className="alert alert-warning alert-with-icon hw-mb-12" role="alert">
          <Icon name="alert" size={16} />
          <span>{t('form.quizLoadFailed')}</span>
        </div>
      )}
      {quizLocked && (
        <div className="alert alert-warning alert-with-icon hw-mb-12">
          <Icon name="alert" size={16} />
          <span>{t('form.quizLocked')}</span>
        </div>
      )}
      {questions.map((q, qi) => {
        const qtype = q.qtype ?? 'single';
        return (
          <div
            key={qi}
            className="quiz-q"
            tabIndex={-1}
            ref={(el) => {
              qBlockRefs.current[qi] = el;
            }}
          >
            <div className="hw-flex hw-mb-8">
              <span className="quiz-num">{qi + 1}</span>
              <input
                className="text-input hw-flex-1"
                placeholder={t('form.questionPh', { n: qi + 1 })}
                value={q.question}
                disabled={builderLocked}
                onChange={(e) => updateQuestion(qi, { question: e.target.value })}
              />
              {questions.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger-ghost"
                  disabled={builderLocked}
                  onClick={() => editQuestions((x) => x.filter((_, j) => j !== qi))}
                  aria-label={t('form.removeQuestion', { n: qi + 1 })}
                >
                  ×
                </button>
              )}
            </div>
            <div className="hw-flex-wrap hw-mb-8">
              <select
                className="text-input"
                aria-label={t('bank.qtype')}
                value={qtype}
                disabled={builderLocked}
                onChange={(e) => changeQuestionType(qi, e.target.value as QType)}
              >
                <option value="single">{t('bank.qtypeSingle')}</option>
                <option value="multiple">{t('bank.qtypeMultiple')}</option>
                <option value="truefalse">{t('bank.qtypeTruefalse')}</option>
                <option value="essay">{t('bank.qtypeEssay')}</option>
              </select>
              <input
                className="text-input hw-w-80"
                type="number"
                min="0.5"
                step="0.5"
                value={q.points}
                disabled={builderLocked}
                // P1-8: không ép 0/NaN thành 1 im lặng — để validate inline báo lỗi (server: điểm > 0, ≤ 1000)
                onChange={(e) => updateQuestion(qi, { points: Number(e.target.value) })}
                title={t('form.points')}
                aria-label={t('form.points')}
                aria-invalid={!(q.points > 0) || q.points > 1000 ? true : undefined}
              />
            </div>
            {(!(q.points > 0) || q.points > 1000) && (
              <div className="field-error hw-mb-8" role="alert">
                {t('form.errors.pointsInvalid')}
              </div>
            )}
            {qtype === 'essay' ? (
              <p className="muted-sm hw-mb-8">{t('bank.essayHint')}</p>
            ) : (
              <>
                {qtype === 'multiple' && <p className="muted-sm">{t('bank.answersMultiple')}</p>}
                {q.options.map((o, oi) => (
                  <div key={oi} className="quiz-opt">
                    <button
                      type="button"
                      className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
                      disabled={builderLocked}
                      onClick={() =>
                        updateOption(qi, oi, {
                          is_correct: qtype === 'multiple' ? !o.is_correct : true,
                        })
                      }
                      title={t('form.correctAnswer')}
                      aria-pressed={o.is_correct}
                    >
                      {qtype === 'multiple' ? (o.is_correct ? '☑' : '☐') : o.is_correct ? '●' : '○'}
                    </button>
                    <input
                      className="text-input input-sm hw-flex-1"
                      placeholder={t('form.optionPh', { letter: String.fromCharCode(65 + oi) })}
                      value={o.text}
                      disabled={builderLocked || qtype === 'truefalse'}
                      onChange={(e) => updateOption(qi, oi, { text: e.target.value })}
                    />
                    {qtype !== 'truefalse' && q.options.length > 2 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger-ghost"
                        disabled={builderLocked}
                        onClick={() => removeOption(qi, oi)}
                        aria-label={t('form.removeOption', { letter: String.fromCharCode(65 + oi) })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {qtype !== 'truefalse' && (
                  <button
                    type="button"
                    className="btn btn-sm hw-mt-4"
                    disabled={builderLocked}
                    onClick={() => addOption(qi)}
                  >
                    {t('form.addOption')}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <div className="hw-flex">
        <button type="button" className="btn" disabled={builderLocked} onClick={addQuestion}>
          {t('form.addQuestion')}
        </button>
        <button
          type="button"
          className="btn hw-action-icon"
          disabled={builderLocked}
          onClick={() => setShowBankPicker(true)}
        >
          <Icon name="book" size={15} /> {t('form.fromBank')}
        </button>
      </div>
    </Field>
  );
}
