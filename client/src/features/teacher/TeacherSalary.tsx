import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { teacherApi, SalaryInfo } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { StatGridSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { formatVND } from '../../shared/types';
import './TeacherSalary.css';

export function TeacherSalary() {
  const { t } = useTranslation(['teacher', 'common']);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [salary, setSalary] = useState<SalaryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await teacherApi.payroll(month);
      setSalary(data);
    } catch (err) {
      // Lỗi tải: xóa số liệu tháng cũ để không hiện nhầm dưới nhãn tháng mới
      setSalary(null);
      setLoadError(true);
      toast(err instanceof Error ? err.message : t('salary.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader title={t('salary.title')} desc={t('salary.desc')} />

      <div className="toolbar">
        <Field label={t('salary.month')}>
          <input
            className="text-input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {loading ? (
        <StatGridSkeleton count={3} />
      ) : loadError ? (
        <EmptyState
          icon="alert"
          title={t('salary.loadError')}
          desc={t('salary.loadErrorDesc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={14} />
              {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      ) : salary ? (
        <>
          <div className="salary-hero">
            <div className="salary-month">
              {t('salary.totalOfMonth', { month: `${month.slice(5, 7)}/${month.slice(0, 4)}` })}
            </div>
            <div className="salary-total">{formatVND(salary.total)}</div>
            <div className="salary-sub">{t('salary.sessionsDone', { count: salary.sessions })}</div>
          </div>
          <div className="card salary-breakdown">
            <div className="salary-row">
              <span>{t('salary.sessions')}</span>
              <strong>{salary.sessions}</strong>
            </div>
            <div className="salary-row">
              <span>{t('salary.perSession')}</span>
              <strong>{formatVND(salary.per_session)}</strong>
            </div>
          </div>
        </>
      ) : (
        <EmptyState icon="wallet" title={t('salary.emptyTitle')} desc={t('salary.emptyDesc')} />
      )}
    </div>
  );
}
