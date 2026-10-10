import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi, type QuizQuestion, type QuizAttempt, type QuizAttemptDetail } from './parent.api';
import { HomeworkItem, formatDate, formatDateTime, isPastCloseDate } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog, Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './parent.css';

// FIX 5: màn hình xem lại đáp án dùng chung cho cả sau khi nộp và quiz đã hoàn thành
// Render theo loại câu hỏi: essay hiện bài làm + "chờ chấm" thay vì đúng/sai.
function QuizReviewView({
  review,
  onBack,
  onDone,
}: {
  review: QuizAttemptDetail[];
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['parent', 'common']);
  return (
    <div className="quiz-review">
      {review.map((q, qi) => {
        if (q.qtype === 'essay') {
          // YC2: đã chấm tay thì hiện điểm chi tiết thay vì badge "Chờ chấm"
          const graded = q.essay_score !== null && q.essay_score !== undefined;
          return (
            <div key={q.question_id} className={`quiz-review-q ${graded ? 'correct' : 'pending'}`}>
              <div className="quiz-review-qhead">
                <Icon name={graded ? 'check' : 'clock'} size={18} className={graded ? 'icon-ok' : 'icon-warn'} />
                <span>{t('quiz.questionLabel', { num: qi + 1, question: q.question })}</span>
                {graded ? (
                  <span className="badge badge-paid">
                    {t('quiz.essayGraded', { score: q.essay_score, max: q.points })}
                  </span>
                ) : (
                  <span className="badge badge-late">{t('quiz.pendingGrade')}</span>
                )}
              </div>
              <div className="quiz-essay-answer">
                <div className="muted-sm">{t('quiz.essayAnswer')}</div>
                <p>{q.answer_text || <span className="muted-sm">-</span>}</p>
              </div>
            </div>
          );
        }
        const gotIt = q.correct === true;
        return (
          <div key={q.question_id} className={`quiz-review-q ${gotIt ? 'correct' : 'wrong'}`}>
            <div className="quiz-review-qhead">
              {gotIt ? (
                <Icon name="check" size={18} className="icon-ok" />
              ) : (
                <Icon name="x" size={18} className="icon-bad" />
              )}
              <span>{t('quiz.questionLabel', { num: qi + 1, question: q.question })}</span>
            </div>
            {q.options.map((o) => (
              <div
                key={o.id}
                className={`quiz-review-opt ${o.is_correct ? 'is-correct' : ''} ${o.chosen && !o.is_correct ? 'is-wrong-choice' : ''}`}
              >
                {o.is_correct ? (
                  <Icon name="check" size={14} />
                ) : o.chosen ? (
                  <Icon name="arrow-right" size={14} />
                ) : (
                  <span className="opt-dot" aria-hidden="true" />
                )}
                <span>{o.text}</span>
                {o.chosen && <span className="muted-xs"> {t('quiz.youChose')}</span>}
              </div>
            ))}
          </div>
        );
      })}
      <div className="modal-actions">
        <button className="btn" onClick={onBack}>
          {t('actions.back', { ns: 'common' })}
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          {t('actions.close', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}

export function QuizTaker({
  homework,
  studentId,
  onClose,
  onDone,
  reviewOnly = false,
}: {
  homework: HomeworkItem;
  studentId: number;
  onClose: () => void;
  onDone: () => void;
  reviewOnly?: boolean;
}) {
  const toast = useToast();
  const { t } = useTranslation(['parent', 'common']);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  // Đáp án trắc nghiệm: id câu hỏi → mảng id đáp án đã chọn (multiple chọn nhiều)
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  // Bài làm tự luận: id câu hỏi → nội dung
  const [essayAnswers, setEssayAnswers] = useState<Record<number, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    max_score: number;
    attempt_id: number;
    attempt_no: number;
  } | null>(null);
  const [review, setReview] = useState<QuizAttemptDetail[] | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [history, setHistory] = useState<QuizAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(reviewOnly);

  // Lịch sử làm bài: chế độ làm bài dùng cho thanh info, chế độ xem lại dùng làm nội dung chính
  useEffect(() => {
    setAttemptsLoading(reviewOnly);
    parentApi
      .getQuizAttempts(homework.id, studentId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setAttemptsLoading(false));
  }, [homework.id, studentId, reviewOnly]);

  // FIX 2: quiz đã qua hạn chót thì không cho mở làm, báo rõ ngay từ đầu
  // (trước đây phụ huynh làm xong mới bị server chặn lúc nộp)
  const isExpired = !reviewOnly && isPastCloseDate(homework.close_date);

  // Tách riêng tải đề để nút "Thử lại" dùng lại được khi mất mạng
  const loadQuiz = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    parentApi
      .getQuiz(homework.id, studentId)
      .then((qs) => {
        setQuestions(qs);
        setQIndex(0);
      })
      .catch((err: Error) => setLoadError(err instanceof Error ? err.message : ''))
      .finally(() => setLoading(false));
  }, [homework.id, studentId]);

  useEffect(() => {
    if (isExpired || reviewOnly) return; // Đã hết hạn / chỉ xem lại thì không tải đề
    loadQuiz();
  }, [loadQuiz, isExpired, reviewOnly]);

  const [confirming, setConfirming] = useState(false);
  const qRef = useRef<HTMLDivElement>(null);

  // Một câu được coi là đã trả lời: trắc nghiệm → chọn ít nhất 1 đáp án;
  // tự luận → gõ nội dung
  const isAnswered = (q: QuizQuestion) =>
    q.qtype === 'essay'
      ? (essayAnswers[q.id] ?? '').trim().length > 0
      : (answers[q.id] ?? []).length > 0;

  // Bấm Nộp bài -> mở dialog xác nhận của app (không dùng confirm() native)
  const submit = () => {
    const firstMissing = questions.findIndex((q) => !isAnswered(q));
    if (firstMissing !== -1) {
      const missing = questions.length - questions.filter(isAnswered).length;
      toast(t('quiz.unanswered', { count: missing }), 'error');
      // FIX 8: cuộn + focus tới câu đầu tiên chưa trả lời (tôn trọng reduced-motion)
      setQIndex(firstMissing);
      requestAnimationFrame(() => {
        const el = qRef.current;
        if (!el) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        el.focus({ preventScroll: true });
      });
      return;
    }
    setConfirming(true);
  };

  const doSubmit = async () => {
    setConfirming(false);
    setSubmitting(true);
    setSubmitError(''); // Giữ nguyên bài làm, lỗi hiển thị ngay dưới nút nộp
    try {
      const res = await parentApi.submitQuiz(
        homework.id,
        studentId,
        questions.map((q) =>
          q.qtype === 'essay'
            ? { question_id: q.id, answer_text: (essayAnswers[q.id] ?? '').trim() || null }
            : { question_id: q.id, option_ids: answers[q.id] ?? [] }
        )
      );
      // HIGH-1: KHÔNG gọi onDone() ngay, hiện màn hình kết quả trước.
      setResult(res);
      setHistory((h) => [
        {
          id: res.attempt_id,
          score: res.score,
          max_score: res.max_score,
          submitted_at: new Date().toISOString(),
          answers: [],
        },
        ...h,
      ]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('quiz.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const loadReview = async (attemptId: number) => {
    if (reviewLoading) return;
    setReviewLoading(true);
    try {
      const r = await parentApi.getAttemptReview(attemptId, studentId);
      setReview(r);
      setShowReview(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('quiz.reviewError'), 'error');
    } finally {
      setReviewLoading(false);
    }
  };

  // MEDIUM-12: làm lại quiz (server cho phép không giới hạn, giữ điểm cao nhất)
  const retry = () => {
    if (isPastCloseDate(homework.close_date)) {
      toast(t('quiz.expiredTitle'), 'error'); // Hạn chót trôi qua giữa chừng thì khóa làm lại
      return;
    }
    setResult(null);
    setReview(null);
    setShowReview(false);
    setAnswers({});
    setEssayAnswers({});
    setQIndex(0);
  };

  const pct = result && result.max_score > 0 ? (result.score / result.max_score) * 100 : 0;

  return (
    <Modal title={t('quiz.title', { title: homework.title })} onClose={onClose} wide>
      {/* Thông tin quiz + lịch sử làm bài */}
      {!reviewOnly && !result && !showReview && (
        <div className="quiz-info-bar">
          <span className="muted-sm">
            {t('quiz.questionCount', { count: questions.length })}
            {homework.max_score != null && ` ${t('quiz.maxScore', { score: homework.max_score })}`}
            {homework.due_date && ` ${t('quiz.dueDate', { date: formatDateTime(homework.due_date) })}`}
            {homework.close_date &&
              homework.close_date !== homework.due_date &&
              ` ${t('quiz.closeDate', { date: formatDateTime(homework.close_date) })}`}
          </span>
          {history.length > 0 && (
            <span className="muted-sm">
              {t('quiz.attempted', { count: history.length })} · {t('quiz.bestScore')}{' '}
              <strong>
                {t('quiz.bestScoreLine', {
                  best: Math.max(...history.map((h) => h.score)),
                  max: history[0].max_score,
                })}
              </strong>
            </span>
          )}
        </div>
      )}
      {reviewOnly ? (
        showReview && review ? (
          <QuizReviewView review={review} onBack={() => setShowReview(false)} onDone={onDone} />
        ) : attemptsLoading ? (
          <div aria-hidden="true" style={{ display: 'grid', gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={52} radius={10} />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon="file"
            title={t('quiz.noAttempts')}
            action={
              <button className="btn btn-inline" onClick={onClose}>
                {t('actions.close', { ns: 'common' })}
              </button>
            }
          />
        ) : (
          <div>
            <p className="muted-sm" style={{ marginBottom: 12 }}>
              {t('quiz.attempted', { count: history.length })} · {t('quiz.bestScore')}{' '}
              <strong>
                {t('quiz.bestScoreLine', {
                  best: Math.max(...history.map((h) => h.score)),
                  max: history[0].max_score,
                })}
              </strong>
            </p>
            <ul className="list">
              {history.map((a) => (
                <li key={a.id} className="list-item">
                  <div>
                    <strong>{t('quiz.attemptLine', { score: a.score, max: a.max_score })}</strong>
                    <div className="muted-sm">{formatDateTime(a.submitted_at)}</div>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={reviewLoading}
                    onClick={() => void loadReview(a.id)}
                  >
                    {t('quiz.viewAnswers')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : isExpired && !result ? (
        <EmptyState
          icon="clock"
          title={t('quiz.expiredTitle')}
          desc={t('quiz.expiredDesc', { date: formatDate(homework.close_date) })}
          action={
            <button className="btn btn-inline" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </button>
          }
        />
      ) : loading ? (
        <div aria-hidden="true">
          <Skeleton width="70%" height={20} radius={8} />
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} radius={10} />
            ))}
          </div>
        </div>
      ) : result && !showReview ? (
        <div className="quiz-result">
          <div className={`quiz-result-ic ${pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'bad'}`}>
            <Icon name={pct >= 50 ? 'check' : 'x'} size={30} />
          </div>
          <div className="quiz-result-score">
            {result.score}/{result.max_score}
          </div>
          <div>
            <span
              className={`badge ${pct >= 80 ? 'badge-paid' : pct >= 50 ? 'badge-late' : 'badge-overdue'}`}
            >
              {pct.toFixed(0)}%
            </span>
            {result.attempt_no > 1 && (
              <span className="muted-sm" style={{ marginLeft: 8 }}>
                {t('quiz.attemptNo', { no: result.attempt_no })}
              </span>
            )}
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            {pct >= 80 ? t('quiz.excellent') : pct >= 50 ? t('quiz.good') : t('quiz.tryHarder')}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              className="btn"
              disabled={reviewLoading}
              onClick={() => void loadReview(result.attempt_id)}
            >
              {reviewLoading && <span className="spinner" aria-hidden="true" />}
              {t('quiz.viewAnswers')}
            </button>
            <button className="btn" onClick={retry}>
              {t('quiz.retry')}
            </button>
            <button className="btn btn-primary" onClick={onDone}>
              {t('actions.close', { ns: 'common' })}
            </button>
          </div>
        </div>
      ) : showReview && review ? (
        <QuizReviewView review={review} onBack={() => setShowReview(false)} onDone={onDone} />
      ) : loadError ? (
        <EmptyState
          icon="alert"
          title={t('quiz.loadErrorTitle')}
          desc={loadError || t('quiz.loadErrorDesc')}
          action={
            <button className="btn btn-inline" onClick={loadQuiz}>
              <Icon name="rotate" size={16} />
              {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      ) : questions.length === 0 ? (
        <EmptyState
          icon="file"
          title={t('quiz.noQuestions')}
          desc={t('quiz.noQuestionsDesc')}
          action={
            <button className="btn btn-inline" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </button>
          }
        />
      ) : (
        <>
          <div className="quiz-progress">
            <div className="quiz-progress-top">
              <span className="quiz-progress-label">
                {t('quiz.progressLabel', { current: qIndex + 1, total: questions.length })}
              </span>
              <span className="muted-sm">
                {t('quiz.answeredCount', {
                  answered: questions.filter(isAnswered).length,
                  total: questions.length,
                })}
              </span>
            </div>
            <div
              className="quiz-progress-bar"
              role="progressbar"
              aria-valuenow={qIndex + 1}
              aria-valuemin={1}
              aria-valuemax={questions.length}
            >
              <div
                className="quiz-progress-fill"
                style={{ width: `${((qIndex + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>
          {(() => {
            const q = questions[qIndex];
            const chosen = answers[q.id] ?? [];
            const toggleOption = (oid: number) => {
              if (q.qtype === 'multiple') {
                setAnswers((a) => ({
                  ...a,
                  [q.id]: chosen.includes(oid) ? chosen.filter((x) => x !== oid) : [...chosen, oid],
                }));
              } else {
                setAnswers((a) => ({ ...a, [q.id]: [oid] }));
              }
            };
            return (
              <div key={q.id} className="quiz-take-q" ref={qRef} tabIndex={-1}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>
                  {q.question}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {' '}
                    {t('quiz.points', { points: q.points })}
                  </span>
                </div>
                {q.qtype === 'multiple' && <p className="muted-sm">{t('quiz.multipleHint')}</p>}
                {q.qtype === 'essay' && <p className="muted-sm">{t('quiz.essayHint')}</p>}
                {q.qtype === 'essay' ? (
                  <textarea
                    className="text-input quiz-essay-input"
                    rows={6}
                    value={essayAnswers[q.id] ?? ''}
                    onChange={(e) => setEssayAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder={t('quiz.essayPlaceholder')}
                    aria-label={q.question}
                    maxLength={20000}
                  />
                ) : (
                  <div
                    role={q.qtype === 'multiple' ? 'group' : 'radiogroup'}
                    aria-label={q.question}
                    className="quiz-take-opts"
                  >
                    {q.options.map((o) => {
                      const isChosen = chosen.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role={q.qtype === 'multiple' ? 'checkbox' : 'radio'}
                          aria-checked={isChosen}
                          className={`quiz-take-opt ${isChosen ? 'selected' : ''}`}
                          onClick={() => toggleOption(o.id)}
                        >
                          <span className={q.qtype === 'multiple' ? 'quiz-checkbox' : 'quiz-radio'} aria-hidden="true" />
                          <span>{o.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="quiz-nav">
            {qIndex > 0 ? (
              <button className="btn" onClick={() => setQIndex((i) => i - 1)}>
                <Icon name="arrow-left" size={16} />
                {t('actions.prev', { ns: 'common' })}
              </button>
            ) : (
              <button className="btn" onClick={onClose}>
                {t('quiz.later')}
              </button>
            )}
            {qIndex < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setQIndex((i) => i + 1)}>
                {t('actions.next', { ns: 'common' })}
                <Icon name="arrow-right" size={16} />
              </button>
            ) : (
              <button className="btn btn-primary" disabled={submitting} onClick={submit}>
                {submitting && <span className="spinner" aria-hidden="true" />}
                {submitting ? t('quiz.grading') : t('quiz.submitQuiz')}
              </button>
            )}
          </div>
          {submitError && (
            <p className="field-error" role="alert" style={{ marginTop: 8 }}>
              {submitError}
            </p>
          )}
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('quiz.confirmTitle')}
          message={t('quiz.confirmSubmit')}
          onClose={() => setConfirming(false)}
          onConfirm={doSubmit}
        />
      )}
    </Modal>
  );
}
