import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type Rubric } from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import type { HwFieldErrors } from './homeworkForm';

/** State rubric của form bài tập: chọn rubric có sẵn hoặc tạo nhanh rubric mới. */
export function useRubric(initial: HomeworkItem | null, fe: HwFieldErrors) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const { errors, show } = fe;
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [rubricId, setRubricId] = useState<string>(initial?.rubric_id?.toString() || '');
  const [showRubricForm, setShowRubricForm] = useState(false);
  const [newRubricName, setNewRubricName] = useState('');
  const defaultCriteria = t('form.defaultCriteria', { returnObjects: true }) as string[];
  const [newCriteria, setNewCriteria] = useState<{ name: string; max_score: string }[]>(() =>
    defaultCriteria.map((name) => ({ name, max_score: '10' }))
  );
  const [rubricBusy, setRubricBusy] = useState(false);

  useEffect(() => {
    homeworkApi
      .listRubrics()
      .then(setRubrics)
      .catch(() => {});
  }, []);

  const createRubricNow = async () => {
    if (rubricBusy) return;
    // Validate inline dưới field + focus field lỗi đầu tiên (skill 8.2)
    const rerrs: { rubricName?: string; rubricCriteria?: string } = {};
    if (!newRubricName.trim()) rerrs.rubricName = t('form.errors.rubricNameRequired');
    const validCriteria = newCriteria
      .map((c) => ({ name: c.name.trim(), max_score: Number(c.max_score) || 0 }))
      .filter((c) => c.name && c.max_score > 0);
    if (validCriteria.length === 0) rerrs.rubricCriteria = t('form.errors.rubricCriteriaRequired');
    // P1-9: merge lỗi rubric vào map hiện có thay vì ghi đè toàn bộ lỗi form;
    // chỉ chặn tạo rubric khi chính rubric có lỗi (lỗi form khác không liên quan).
    if (Object.keys(rerrs).length > 0) {
      show({ ...errors, ...rerrs });
      return;
    }
    setRubricBusy(true);
    try {
      const r = await homeworkApi.createRubric(newRubricName.trim(), validCriteria);
      setRubrics((rs) => [r, ...rs]);
      setRubricId(String(r.id));
      setShowRubricForm(false);
      setNewRubricName('');
      toast(t('form.toast.rubricCreated'), 'success');
    } catch (err) {
      toastApiError(toast, err, t('form.toast.rubricFail'));
    } finally {
      setRubricBusy(false);
    }
  };

  return {
    rubrics,
    rubricId,
    setRubricId,
    showRubricForm,
    setShowRubricForm,
    newRubricName,
    setNewRubricName,
    newCriteria,
    setNewCriteria,
    rubricBusy,
    createRubricNow,
  };
}

export type RubricState = ReturnType<typeof useRubric>;

/** Chọn rubric + xem tiêu chí + form tạo rubric mới (bài thường chấm tay; quiz chấm câu tự luận — YC2). */
export function RubricField({ r, fe, isQuiz }: { r: RubricState; fe: HwFieldErrors; isQuiz: boolean }) {
  const { t } = useTranslation(['homework', 'common']);
  const { errors, refFor, clear } = fe;
  const { rubrics, rubricId, newCriteria, setNewCriteria, rubricBusy } = r;
  const selectedRubric = rubrics.find((x) => String(x.id) === rubricId);
  return (
    <Field label={t('form.rubric')} hint={isQuiz ? t('form.rubricQuizHint') : undefined}>
      <div className="hw-flex hw-mb-8">
        <select
          className="text-input hw-flex-1"
          value={rubricId}
          onChange={(e) => r.setRubricId(e.target.value)}
        >
          <option value="">{t('form.noRubric')}</option>
          {rubrics.map((x) => (
            <option key={x.id} value={x.id}>
              {t('form.rubricOption', { name: x.name, score: x.total_score })}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => r.setShowRubricForm((s) => !s)}>
          {t('form.newRubric')}
        </button>
      </div>
      {selectedRubric && (
        <div className="rubric-preview">
          {selectedRubric.criteria.map((c) => (
            <div key={c.id} className="rubric-row">
              <span>{c.name}</span>
              <span className="num">{t('form.criterionScore', { score: c.max_score })}</span>
            </div>
          ))}
        </div>
      )}
      {r.showRubricForm && (
        <div className="rubric-form">
          <input
            ref={refFor('rubricName')}
            className="text-input hw-mb-8"
            placeholder={t('form.rubricNamePh')}
            value={r.newRubricName}
            onChange={(e) => {
              r.setNewRubricName(e.target.value);
              clear('rubricName');
            }}
            aria-invalid={errors.rubricName ? true : undefined}
          />
          {errors.rubricName && (
            <span className="field-error" role="alert">
              {errors.rubricName}
            </span>
          )}
          {newCriteria.map((c, i) => (
            <div key={i} className="hw-flex hw-mb-8">
              <input
                ref={i === 0 ? refFor('rubricCriteria') : undefined}
                className="text-input"
                placeholder={t('form.criterion')}
                value={c.name}
                onChange={(e) => {
                  setNewCriteria((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)));
                  clear('rubricCriteria');
                }}
                aria-invalid={errors.rubricCriteria ? true : undefined}
              />
              <input
                className="text-input hw-w-100"
                type="number"
                min="0"
                placeholder={t('form.points')}
                value={c.max_score}
                onChange={(e) =>
                  setNewCriteria((x) => x.map((y, j) => (j === i ? { ...y, max_score: e.target.value } : y)))
                }
              />
              <button
                type="button"
                className="btn btn-sm btn-danger-ghost"
                onClick={() => setNewCriteria((x) => x.filter((_, j) => j !== i))}
                aria-label={t('form.removeCriterion', { n: i + 1 })}
              >
                ×
              </button>
            </div>
          ))}
          {errors.rubricCriteria && (
            <span className="field-error" role="alert">
              {errors.rubricCriteria}
            </span>
          )}
          <div className="hw-flex">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setNewCriteria((x) => [...x, { name: '', max_score: '10' }])}
            >
              {t('form.addCriterion')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={rubricBusy}
              onClick={r.createRubricNow}
            >
              {rubricBusy && <span className="spinner" aria-hidden="true" />}
              {rubricBusy ? t('actions.saving', { ns: 'common' }) : t('form.saveRubric')}
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}
