import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type EssayGradingData } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { Skeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { useFieldErrors } from '../../shared/components/Form';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import { formatDateTime } from '../../shared/types';

/**
 * YC2: giáo viên chấm từng câu tự luận của quiz theo tiêu chí rubric.
 * Mỗi câu essay hiện bài làm của học viên + form nhập điểm từng tiêu chí;
 * lưu theo câu (idempotent - chấm lại ghi đè), tổng = trắc nghiệm + tay.
 */
export function EssayGradeModal({
  homeworkId,
  title,
  studentId,
  studentName,
  maxScore,
  onClose,
}: {
  homeworkId: number;
  title: string;
  studentId: number;
  studentName: string;
  maxScore: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [data, setData] = useState<EssayGradingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Điểm nhập theo "questionId:criterionId" (chuỗi để giữ nguyên khi gõ dở)
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  // Chống bấm đúp: chỉ câu đang lưu mới busy
  const [busyQid, setBusyQid] = useState<number | null>(null);
  // Lỗi inline dưới từng ô điểm + focus ô lỗi đầu tiên
  const { errors, refFor, show, clear } = useFieldErrors<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const d = await homeworkApi.getEssayGrading(homeworkId, studentId);
      setData(d);
      setFeedback(d.feedback ?? '');
      // Điền sẵn điểm đã chấm để giáo viên sửa tiếp
      const pre: Record<string, string> = {};
      for (const q of d.questions)
        for (const s of q.scores) pre[`${q.question_id}:${s.criterion_id}`] = String(s.score);
      setInputs(pre);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [homeworkId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setInput = (qid: number, cid: number, v: string) => {
    setInputs((p) => ({ ...p, [`${qid}:${cid}`]: v }));
    clear(`q${qid}c${cid}`);
    clear(`q${qid}`);
  };

  /** Validate + lưu điểm 1 câu essay. Ô bỏ trống = chưa chấm tiêu chí đó (bỏ qua). */
  const saveQuestion = async (qid: number) => {
    if (busyQid !== null || !data) return;
    const criteria: { criterion_id: number; score: number }[] = [];
    const errs: Record<string, string> = {};
    for (const c of data.rubric.criteria) {
      const raw = (inputs[`${qid}:${c.id}`] ?? '').trim();
      if (raw === '') continue;
      const s = Number(raw);
      if (!Number.isFinite(s) || s < 0) errs[`q${qid}c${c.id}`] = t('essay.invalidScore');
      else if (s > c.max_score) errs[`q${qid}c${c.id}`] = t('essay.overCriterion', { max: c.max_score });
      else criteria.push({ criterion_id: c.id, score: s });
    }
    if (criteria.length === 0 && Object.keys(errs).length === 0) errs[`q${qid}`] = t('essay.noScore');
    if (!show(errs)) return;
    setBusyQid(qid);
    try {
      const r = await homeworkApi.gradeQuizEssay(homeworkId, studentId, qid, criteria, feedback.trim());
      toast(t('essay.saved', { total: r.total }), 'success');
      await load(); // tải lại để tổng + trạng thái "đã chấm" cập nhật
    } catch (err) {
      toast(err instanceof Error ? err.message : t('essay.saveFail'), 'error');
    } finally {
      setBusyQid(null);
    }
  };

  // Câu được coi là đã chấm xong khi mọi tiêu chí đều có điểm
  const isQuestionDone = (qid: number) =>
    !!data && data.rubric.criteria.every((c) => (inputs[`${qid}:${c.id}`] ?? '').trim() !== '');

  return (
    <Modal title={t('essay.title', { title })} onClose={onClose} wide>
      {loading ? (
        <div aria-hidden="true" style={{ display: 'grid', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={64} radius={10} />
          ))}
        </div>
      ) : error || !data ? (
        <EmptyState
          icon="alert"
          title={t('states.error', { ns: 'common' })}
          desc={t('essay.loadFail')}
          action={
            <button className="btn btn-secondary btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={14} /> {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      ) : data.questions.length === 0 ? (
        <EmptyState icon="file" title={t('essay.noEssay')} desc={t('essay.noEssayDesc')} />
      ) : (
        <>
          <div className="essay-summary">
            <span className="grade-name">{studentName}</span>
            <span className="badge badge-general">{t('essay.rubricName', { name: data.rubric.name })}</span>
            <span className="muted-sm">
              {t('essay.autoScore', { score: data.auto_score })}
              {data.total_score !== null &&
                maxScore !== null &&
                ` · ${t('essay.totalScore', { score: data.total_score, max: maxScore })}`}
            </span>
          </div>
          <div className="hw-mb-16">
            <label className="field-label" htmlFor="essay-feedback">
              {t('essay.feedback')}
            </label>
            <textarea
              id="essay-feedback"
              className="text-input"
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t('essay.feedbackPh')}
              maxLength={2000}
            />
          </div>
          {data.questions.map((q, qi) => (
            <section key={q.question_id} className="essay-q" aria-label={t('essay.questionN', { n: qi + 1 })}>
              <div className="essay-q-head">
                <span>
                  {t('essay.questionN', { n: qi + 1 })}: {q.question}
                </span>
                {isQuestionDone(q.question_id) ? (
                  <span className="badge badge-paid">{t('essay.done')}</span>
                ) : (
                  <span className="badge badge-late">{t('essay.pending')}</span>
                )}
              </div>
              <div className="muted-sm">
                {t('essay.points', { points: q.points })}
                {q.submitted_at && ` · ${t('essay.submittedAt', { time: formatDateTime(q.submitted_at) })}`}
              </div>
              <div className="muted-sm hw-mt-8">{t('essay.answerLabel')}</div>
              <div className="essay-answer">
                {q.answer_text ? q.answer_text : <span className="muted-sm">{t('essay.noAnswer')}</span>}
              </div>
              {data.rubric.criteria.map((c) => {
                const key = `q${q.question_id}c${c.id}`;
                return (
                  <div key={c.id}>
                    <div className="essay-criterion">
                      <label htmlFor={key}>{c.name}</label>
                      <input
                        ref={refFor(key)}
                        id={key}
                        className="text-input"
                        type="number"
                        min="0"
                        max={c.max_score}
                        step="0.5"
                        value={inputs[`${q.question_id}:${c.id}`] ?? ''}
                        onChange={(e) => setInput(q.question_id, c.id, e.target.value)}
                        aria-invalid={errors[key] ? true : undefined}
                      />
                      <span className="muted num">/ {c.max_score}</span>
                    </div>
                    {errors[key] && (
                      <span className="field-error" role="alert">
                        {errors[key]}
                      </span>
                    )}
                  </div>
                );
              })}
              {errors[`q${q.question_id}`] && (
                <span className="field-error" role="alert">
                  {errors[`q${q.question_id}`]}
                </span>
              )}
              <div className="modal-actions grade-actions">
                <button
                  className="btn btn-primary hw-action-icon"
                  disabled={busyQid !== null}
                  onClick={() => void saveQuestion(q.question_id)}
                >
                  <Icon name="check" size={15} />
                  {busyQid === q.question_id && <span className="spinner" aria-hidden="true" />}
                  {busyQid === q.question_id
                    ? t('actions.saving', { ns: 'common' })
                    : t('essay.saveQuestion')}
                </button>
              </div>
            </section>
          ))}
        </>
      )}
    </Modal>
  );
}
