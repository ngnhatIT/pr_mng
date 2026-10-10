import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { dashboardApi } from './dashboard.api';
import { DebtRow } from '../tuition/tuition.api';
import { useToast } from '../../shared/ui/toast';
import { DashboardData, formatVND } from '../../shared/types';
import { getUser } from '../../shared/api/client';
import { PageHeader } from '../../shared/components/PageHeader';
import { Skeleton } from '../../shared/components/Skeleton';
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
  // Tổng số học viên còn nợ (pagination.total từ /invoices/debt): số liệu thật
  // dùng làm sub-info cho hero; null khi không tải được hoặc không có quyền
  const [debtTotal, setDebtTotal] = useState<number | null>(null);
  const [debtsError, setDebtsError] = useState(false);
  // Tài khoản bị giới hạn quyền tài chính (topDebts 403): ẩn hero công nợ
  // thay vì hiện "0đ" gây hiểu nhầm — cùng cách widget "Công nợ cao nhất" xử lý
  const [financeDenied, setFinanceDenied] = useState(false);
  const [loading, setLoading] = useState(true);  const toast = useToast();
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
        setDebtTotal(debt.pagination.total);
        setDebtsError(false);
        setFinanceDenied(false);
      } catch (err) {
        setDebts([]);
        setDebtTotal(null);
        // 403 thiếu quyền (teacher): ẩn widget + hero công nợ êm; lỗi khác mới báo + cho thử lại
        const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
        setDebtsError(code !== 'FORBIDDEN');
        setFinanceDenied(code === 'FORBIDDEN');
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
        {/* Skeleton đúng từng khối: hero + strip 3 số, không phải 4 card đều nhau */}
        <div aria-hidden="true" style={{ marginTop: 20 }}>
          <Skeleton width="100%" height={124} radius={16} />
          <div className="dash-strip" style={{ marginTop: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="dash-stat">
                <Skeleton width="55%" height={13} radius={6} />
                <div style={{ marginTop: 8 }}>
                  <Skeleton width="80%" height={26} radius={8} />
                </div>
              </div>
            ))}
          </div>
        </div>
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

  const stripStats = [
    {
      label: t('stats.revenue'),
      value: formatVND(data.revenueThisMonth),
      sub: t('stats.revenueSub'),
    },
    {
      label: t('stats.students'),
      value: String(data.studyingStudents),
      sub: t('stats.studentsSub', { total: data.totalStudents }),
    },
    {
      label: t('stats.classes'),
      value: String(data.activeClasses),
      sub: t('stats.classesSub', { total: data.totalTeachers }),
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

      {/* Hero: học phí chưa thu, thứ chủ trung tâm nhìn đầu tiên.
          Sub-info duy nhất là số học viên còn nợ (pagination.total thật từ API),
          không có thì ẩn, tuyệt đối không fake trend hay số ước lượng.
          Ẩn hẳn khi tài khoản không có quyền tài chính (server trả 0 khi scope own) */}
      {!financeDenied && (
        <Link to="/app/tuition?tab=debt" className="dash-hero">
          <span className="dash-hero-row">
            <span className="dash-hero-label">
              <Icon name="alert" size={18} className="dash-hero-icon" />
              {t('stats.debt')}
            </span>
            <Icon name="arrow-right" size={16} className="dash-hero-chev" />
          </span>
          <span className="dash-hero-value">{formatVND(data.unpaidTotal)}</span>
          {debtTotal !== null && (
            <span className="dash-hero-sub">{t('hero.debtors', { total: debtTotal })}</span>
          )}
        </Link>
      )}

      {/* 3 số còn lại: strip chia cột, không phải 4 card giống nhau */}
      <div className="dash-strip">
        {stripStats.map((s) => (
          <div key={s.label} className="dash-stat">
            <span className="dash-stat-label">{s.label}</span>
            <span className="dash-stat-value">{s.value}</span>
            <span className="dash-stat-sub">{s.sub}</span>
          </div>
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
          {debtsError ? (
            <EmptyState
              icon="alert"
              title={t('debtLoadErrorTitle')}
              desc={t('debtLoadErrorDesc')}
              action={
                <button className="btn btn-inline" onClick={() => void load()}>
                  <Icon name="rotate" size={14} />
                  {t('actions.retry', { ns: 'common' })}
                </button>
              }
            />
          ) : debts.length === 0 ? (
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
