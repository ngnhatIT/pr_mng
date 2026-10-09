import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from './dashboard.api';
import { DebtRow } from '../tuition/tuition.api';
import { useToast } from '../../shared/ui/toast';
import { DashboardData, formatVND } from '../../shared/types';
import { getUser } from '../../shared/api/client';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatCard } from '../../shared/components/StatCard';
import { StatGridSkeleton } from '../../shared/components/Skeleton';
import { Icon, IconName } from '../../shared/components/icons';
import './Dashboard.css';

const QUICK_ACTIONS: { to: string; label: string; desc: string; icon: IconName }[] = [
  { to: '/app/students', label: 'Thêm học viên', desc: 'Tạo hồ sơ học viên mới', icon: 'plus' },
  { to: '/app/tuition', label: 'Tạo hóa đơn', desc: 'Lập phiếu thu học phí', icon: 'banknote' },
  { to: '/app/attendance', label: 'Điểm danh', desc: 'Ghi nhận buổi học', icon: 'clipboard' },
  { to: '/app/zalo-reminders', label: 'Nhắc học phí', desc: 'Gửi nhắc qua Zalo', icon: 'bell' },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 13) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function todayLine(): string {
  const d = new Date();
  const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  return `${days[d.getDay()]}, ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const user = getUser();

  useEffect(() => {
    (async () => {
      try {
        const [d, debt] = await Promise.all([dashboardApi.summary(), dashboardApi.topDebts({ limit: 5 })]);
        setData(d);
        setDebts(debt.data);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không tải được dữ liệu', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Tổng quan" desc="Tình hình hoạt động của trung tâm hôm nay" />
        <StatGridSkeleton />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Tổng quan" />
        <div className="loading">Không có dữ liệu</div>
      </div>
    );
  }

  const stats = [
    {
      label: 'Học viên đang học',
      value: data.studyingStudents,
      sub: `${data.totalStudents} học viên tổng`,
      tone: 'blue' as const,
      icon: 'users' as IconName,
    },
    {
      label: 'Lớp đang mở',
      value: data.activeClasses,
      sub: `${data.totalTeachers} giáo viên`,
      tone: 'green' as const,
      icon: 'book' as IconName,
    },
    {
      label: 'Doanh thu tháng này',
      value: formatVND(data.revenueThisMonth),
      sub: 'từ các khoản đã thu',
      tone: 'violet' as const,
      icon: 'wallet' as IconName,
    },
    {
      label: 'Công nợ cần thu',
      value: formatVND(data.unpaidTotal),
      sub: 'hóa đơn chưa thanh toán hết',
      tone: 'amber' as const,
      icon: 'alert' as IconName,
    },
  ];

  return (
    <div className="page">
      <div className="dash-greet">
        <div>
          <h1 className="dash-greet-title">
            {greeting()}, {user?.name || 'bạn'}
          </h1>
          <p className="dash-greet-sub">
            {todayLine()} · {data.todaySessions.length > 0
              ? `Hôm nay có ${data.todaySessions.length} buổi học`
              : 'Hôm nay không có buổi học nào'}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        {stats.map((s) => (
          <StatCard key={s.label} icon={s.icon} value={s.value} label={s.label} sub={s.sub} tone={s.tone} />
        ))}
      </div>

      <div className="dash-section-label">Thao tác nhanh</div>
      <div className="quick-actions dash-quick">
        {QUICK_ACTIONS.map((q) => (
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
            <h2>Buổi học hôm nay</h2>
            <Link className="link" to="/app/attendance">
              Điểm danh <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {data.todaySessions.length === 0 ? (
            <p className="muted">Hôm nay không có buổi học nào.</p>
          ) : (
            <ul className="list">
              {data.todaySessions.map((s) => (
                <li key={s.id} className="list-item">
                  <div>
                    <div className="list-title">{s.class_name}</div>
                    <div className="list-sub">
                      {s.teacher_name || 'Chưa phân công'} · {s.scheduleText}
                      {s.topic ? ` · Chủ đề: ${s.topic}` : ''}
                    </div>
                  </div>
                  <Link className="btn btn-sm" to={`/app/attendance?class=${s.class_id}&session=${s.id}`}>
                    Điểm danh
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Công nợ cao nhất</h2>
            <Link className="link" to="/app/tuition?tab=debt">
              Xem tất cả <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {debts.length === 0 ? (
            <p className="muted">Không có công nợ.</p>
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
