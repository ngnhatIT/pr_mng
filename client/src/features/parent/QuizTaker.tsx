import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi, type QuizQuestion, type QuizAttempt } from './parent.api';
import { HomeworkItem, formatDate } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog, Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './parent.css';

interface QuizAttemptDetail {
  question_id: number;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}

export function QuizTaker({
  homework,
  studentId,
  onClose,
  onDone,
}: {
  homework: HomeworkItem;
  studentId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { t } = useTranslation(['parent', 'common']);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
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

  useEffect(() => {
    parentApi
      .getQuizAttempts(homework.id, studentId)
      .then(setHistory)
      .catch(() => {});
  }, [homework.id, studentId]);

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
    loadQuiz();
  }, [loadQuiz]);

  const [confirming, setConfirming] = useState(false);

  // Bấm Nộp bài -> mở dialog xác nhận của app (không dùng confirm() native)
  const submit = () => {
    if (Object.keys(answers).length < questions.length) {
      toast(t('quiz.unanswered', { count: questions.length - Object.keys(answers).length }), 'error');
      return;
    }
    setConfirming(true);
  };

  const doSubmit = async () => {
    setConfirming(false);
    setSubmitting(true);
    setSubmitError(''); // bai lam giu nguyen, loi hien ngay duoi nut nop
    try {
      const res = await parentApi.submitQuiz(
        homework.id,
        studentId,
        Object.entries(answers).map(([qid, oid]) => ({ question_id: Number(qid), option_id: oid }))
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
    setResult(null);
    setReview(null);
    setShowReview(false);
    setAnswers({});
    setQIndex(0);
  };

  const pct = result && result.max_score > 0 ? (result.score / result.max_score) * 100 : 0;

  return (
    <Modal title={t('quiz.title', { title: homework.title })} onClose={onClose} wide>
      {/* Thông tin quiz + lịch sử làm bài */}
      {!result && !showReview && (
        <div className="quiz-info-bar">
          <span className="muted" style={{ fontSize: 13 }}>
            {t('quiz.questionCount', { count: questions.length })}
            {homework.max_score != null && ` ${t('quiz.maxScore', { score: homework.max_score })}`}
            {homework.due_date && ` ${t('quiz.dueDate', { date: formatDate(homework.due_date) })}`}
          </span>
          {history.length > 0 && (
            <span className="muted" style={{ fontSize: 13 }}>
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
      {loading ? (
        <div aria-hidden="true">
          <Skeleton width="70%" height={20} radius={8} />
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} radius={10} />
            ))}
          </div>
        </div>
      ) : result ? (
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
              <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
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
        <div className="quiz-review">
          {review.map((q, qi) => {
            const gotIt = q.options.some((o) => o.chosen && o.is_correct);
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
                    {o.chosen && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {' '}
                        {t('quiz.youChose')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowReview(false)}>
              {t('actions.back', { ns: 'common' })}
            </button>
            <button className="btn btn-primary" onClick={onDone}>
              {t('actions.close', { ns: 'common' })}
            </button>
          </div>
        </div>
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
              <span className="muted" style={{ fontSize: 13 }}>
                {t('quiz.answeredCount', { answered: Object.keys(answers).length, total: questions.length })}
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
            return (
              <div key={q.id} className="quiz-take-q">
                <div style={{ fontWeight: 600, marginBottom: 12 }}>
                  {q.question}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {' '}
                    {t('quiz.points', { points: q.points })}
                  </span>
                </div>
                <div role="radiogroup" aria-label={q.question} className="quiz-take-opts">
                  {q.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.id] === o.id}
                      className={`quiz-take-opt ${answers[q.id] === o.id ? 'selected' : ''}`}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                    >
                      <span className="quiz-radio" aria-hidden="true" />
                      <span>{o.text}</span>
                    </button>
                  ))}
                </div>
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
