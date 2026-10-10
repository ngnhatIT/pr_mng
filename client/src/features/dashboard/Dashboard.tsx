import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { dashboardApi } from './dashboard.api';
import { DebtRow } from '../tuition/tuition.api';
import { useToast } from '../../shared/ui/toast';
import { DashboardData, formatVND } from '../../shared/types';
import { getUser } from '../../shared/api/client';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatCard } from '../../shared/components/StatCard';
import { StatGridSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon, IconName } from '../../shared/components/icons';
import './Dashboard.css';

function greeting(t: (k: string) => string): string {
  const h = new Date().getHours();
  if (h < 11) return t('greeting.morning');
  if (h < 13) return t('greeting.midday');
  if (h < 18) return t('greeting.afternoon');
  return t('greeting.evening');
}

function todayLine(lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

export function Dashboard() {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const [data, setData] = useState<DashboardData | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();
  const user = getUser();

  const quickActions: { to: string; label: string; desc: string; icon: IconName }[] = [
    { to: '/app/students', label: t('quick.addStudent'), desc: t('quick.addStudentDesc'), icon: 'plus' },
    {
      to: '/app/tuition',
      label: t('quick.createInvoice'),
      desc: t('quick.createInvoiceDesc'),
      icon: 'banknote',
    },
    {
      to: '/app/attendance',
      label: t('quick.attendance'),
      desc: t('quick.attendanceDesc'),
      icon: 'clipboard',
    },
    { to: '/app/zalo-reminders', label: t('quick.zalo'), desc: t('quick.zaloDesc'), icon: 'bell' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const d = await dashboardApi.summary();
      setData(d);
      try {
        // Teacher không có quyền invoices.view → 403, bỏ qua (không vỡ dashboard)
        const debt = await dashboardApi.topDebts({ limit: 5 });
        setDebts(debt.data);
      } catch {
        setDebts([]);
      }
    } catch (err) {
      setLoadError(true);
      toast(err instanceof Error ? err.message : t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title={t('pageTitle')} desc={t('pageDesc')} />
        <StatGridSkeleton />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <PageHeader title={t('pageTitle')} desc={t('pageDesc')} />
        <EmptyState
          icon="alert"
          title={loadError ? t('loadError') : t('noData')}
          desc={loadError ? t('loadErrorDesc') : undefined}
          action={
            loadError ? (
              <button className="btn btn-primary btn-inline" onClick={() => void load()}>
                <Icon name="rotate" size={14} />
                {t('actions.retry', { ns: 'common' })}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const stats = [
    {
      label: t('stats.students'),
      value: data.studyingStudents,
      sub: t('stats.studentsSub', { total: data.totalStudents }),
      tone: 'blue' as const,
      icon: 'users' as IconName,
    },
    {
      label: t('stats.classes'),
      value: data.activeClasses,
      sub: t('stats.classesSub', { total: data.totalTeachers }),
      tone: 'green' as const,
      icon: 'book' as IconName,
    },
    {
      label: t('stats.revenue'),
      value: formatVND(data.revenueThisMonth),
      sub: t('stats.revenueSub'),
      tone: 'violet' as const,
      icon: 'wallet' as IconName,
    },
    {
      label: t('stats.debt'),
      value: formatVND(data.unpaidTotal),
      sub: t('stats.debtSub'),
      tone: 'amber' as const,
      icon: 'alert' as IconName,
    },
  ];

  return (
    <div className="page">
      <div className="dash-greet">
        <div>
          <h1 className="dash-greet-title">
            {greeting(t)}, {user?.name || t('fallbackName')}
          </h1>
          <p className="dash-greet-sub">
            {todayLine(i18n.language)} ·{' '}
            {data.todaySessions.length > 0
              ? t('today.count', { count: data.todaySessions.length })
              : t('today.empty')}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        {stats.map((s) => (
          <StatCard key={s.label} icon={s.icon} value={s.value} label={s.label} sub={s.sub} tone={s.tone} />
        ))}
      </div>

      <div className="dash-section-label">{t('quick.actionsTitle')}</div>
      <div className="quick-actions dash-quick">
        {quickActions.map((q) => (
          <Link key={q.to} to={q.to} className="quick-action">
            <span className="quick-action-icon">
              <Icon name={q.icon} size={20} />
            </span>
            <span className="quick-action-text">
              <strong>{q.label}</strong>
              <small>{q.desc}</small>
            </span>
            <Icon name="chevron-right" size={16} className="quick-action-chev" />
          </Link>
        ))}
      </div>

      <div className="two-col dash-cols">
        <section className="card">
          <div className="card-head">
            <h2>{t('today.title')}</h2>
            <Link className="link" to="/app/attendance">
              {t('today.attendance')} <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {data.todaySessions.length === 0 ? (
            <p className="muted">{t('today.empty')}</p>
          ) : (
            <ul className="list">
              {data.todaySessions.map((s) => (
                <li key={s.id} className="list-item">
                  <div>
                    <div className="list-title">{s.class_name}</div>
                    <div className="list-sub">
                      {s.teacher_name || t('today.unassigned')} · {s.scheduleText}
                    </div>
                    {s.topic && <div className="list-sub">{t('today.topic', { topic: s.topic })}</div>}
                  </div>
                  <Link className="btn btn-sm" to={`/app/attendance?class=${s.class_id}&session=${s.id}`}>
                    {t('today.attendance')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('debtTitle')}</h2>
            <Link className="link" to="/app/tuition?tab=debt">
              {t('viewAll')} <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {debts.length === 0 ? (
            <p className="muted">{t('debtEmpty')}</p>
          ) : (
            <ul className="list">
              {debts.map((d) => (
                <li key={d.id} className="list-item">
                  <div>
                    <div className="list-title">
                      {d.name} <span className="muted">({d.code})</span>
                    </div>
                    <div className="list-sub">{d.phone || ''}</div>
                  </div>
                  <div className="debt-amount">{formatVND(d.debt)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
