import { useTranslation } from 'react-i18next';
import { todayVN } from '../../shared/types';
import { Field } from '../../shared/components/Form';
import { quickDate, type HwFieldErrors } from './homeworkForm';

/** Điểm tối đa + hạn nộp (+ nút ngày nhanh) + hạn chót cứng của form bài tập. */
export function DeadlineFields({
  isQuiz,
  isEdit,
  quizTotal,
  maxScore,
  setMaxScore,
  dueDate,
  setDueDate,
  closeDate,
  setCloseDate,
  fe,
}: {
  isQuiz: boolean;
  isEdit: boolean;
  quizTotal: number;
  maxScore: string;
  setMaxScore: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  closeDate: string;
  setCloseDate: (v: string) => void;
  fe: HwFieldErrors;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const { errors, refFor, clear } = fe;
  const quickDueOptions = [
    { k: 'today', label: t('form.dueToday') },
    { k: 'tomorrow', label: t('form.dueTomorrow') },
    { k: 'weekend', label: t('form.dueWeekend') },
    { k: 'nextweek', label: t('form.dueNextWeek') },
  ] as const;

  return (
    <>
      <div className="form-grid">
        {isQuiz ? (
          // P1-5: điểm quiz tự tính từ tổng điểm câu hỏi (server cũng re-sync), khóa nhập tay để khỏi lệch
          <Field label={t('form.maxScore')} hint={t('form.quizScoreAuto')}>
            <input className="text-input" type="number" value={quizTotal} disabled />
          </Field>
        ) : (
          <Field label={t('form.maxScore')} error={errors.maxScore}>
            <input
              ref={refFor('maxScore')}
              className="text-input"
              type="number"
              min="0"
              step="0.5"
              value={maxScore}
              onChange={(e) => {
                setMaxScore(e.target.value);
                clear('maxScore');
              }}
              placeholder={t('form.maxScorePh')}
            />
          </Field>
        )}
        <Field label={t('form.dueDate')} error={errors.dueDate}>
          <input
            ref={refFor('dueDate')}
            className="text-input"
            type="date"
            value={dueDate}
            min={isEdit ? undefined : todayVN()}
            onChange={(e) => {
              setDueDate(e.target.value);
              clear('dueDate');
            }}
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label={t('form.quickDue')} group>
          <div className="hw-flex-6-wrap">
            {quickDueOptions.map(({ k, label }) => (
              <button
                key={k}
                type="button"
                className={`btn btn-sm ${dueDate === quickDate(k) ? 'btn-primary' : ''}`}
                onClick={() => setDueDate(quickDate(k))}
              >
                {label}
              </button>
            ))}
            {dueDate && (
              <button type="button" className="btn btn-sm" onClick={() => setDueDate('')}>
                {t('actions.delete', { ns: 'common' })}
              </button>
            )}
          </div>
        </Field>
        <Field label={t('form.hardDeadline')} error={errors.closeDate}>
          <input
            ref={refFor('closeDate')}
            className="text-input"
            type="date"
            value={closeDate}
            min={isEdit ? undefined : dueDate || todayVN()}
            onChange={(e) => {
              setCloseDate(e.target.value);
              clear('closeDate');
            }}
          />
          <div className="muted hw-text-12">{t('form.hardDeadlineHint')}</div>
        </Field>
      </div>
    </>
  );
}
