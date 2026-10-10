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
import { StatGridSkeleton, Skeleton } from '../../shared/components/Skeleton';
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
      toast(err instanceof Error ? err.message : t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    // Skeleton mô phỏng đúng từng khối của trang để không giật layout khi dữ liệu về
    return (
      <div className="page">
        <div className="dash-greet" aria-hidden="true">
          <Skeleton width="45%" height={30} radius={8} />
          <div style={{ marginTop: 8 }}>
            <Skeleton width="32%" height={16} radius={6} />
          </div>
        </div>
        <StatGridSkeleton />
        <div className="dash-section-label" aria-hidden="true">
          <Skeleton width={180} height={18} radius={6} />
        </div>
        <div className="quick-actions dash-quick" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="quick-action">
              <Skeleton width={42} height={42} radius={12} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width="60%" height={14} radius={6} />
                <div style={{ marginTop: 6 }}>
                  <Skeleton width="85%" height={12} radius={6} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="two-col dash-cols" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <Skeleton width="40%" height={20} radius={6} />
              <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} height={44} radius={8} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!data) {
    // Không có data sau khi tải xong luôn là lỗi (server không bao giờ trả null khi thành công)
    return (
      <div className="page">
        <PageHeader title={t('pageTitle')} desc={t('pageDesc')} />
        <EmptyState
          icon="alert"
          title={t('loadError')}
          desc={t('loadErrorDesc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={14} />
              {t('actions.retry', { ns: 'common' })}
            </button>
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
