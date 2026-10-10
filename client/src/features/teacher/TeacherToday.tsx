import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { teacherApi } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { TeacherTodayItem, formatDate, formatDateTime } from '../../shared/types';
import './TeacherToday.css';

export function TeacherToday() {
  const { t } = useTranslation(['teacher', 'common']);
  const [sessions, setSessions] = useState<TeacherTodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'code'>();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teacherApi.today();
      setSessions(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('today.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkin = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mã chấm công sai định dạng / sai mã: báo inline dưới ô nhập (skill 8.2)
    if (!/^\d{6}$/.test(code.trim())) {
      show({ code: t('checkin.invalidCode') });
      return;
    }
    setCheckingIn(true);
    try {
      const r = await teacherApi.checkin(code.trim());
      toast(t('checkin.success', { className: r.class_name, date: formatDate(r.date) }), 'success');
      setCode('');
      void load();
    } catch (err) {
      show({ code: err instanceof Error ? err.message : t('checkin.fail') });
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('today.title')} desc={t('today.desc')} />

      {loading ? (
        <div className="timeline" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot" />
              <div className="timeline-card card">
                <Skeleton width="50%" height={16} />
                <div style={{ marginTop: 8 }}>
                  <Skeleton width="80%" height={12} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState icon="calendar" title={t('today.emptyTitle')} desc={t('today.emptyDesc')} />
      ) : (
        <div className="timeline">
          {sessions.map((s) => (
            <div key={s.session_id} className="timeline-item">
              <div className={`timeline-dot${s.checked_in ? ' done' : ''}`}>
                {s.checked_in && <Icon name="check" size={12} />}
              </div>
              <div className={`timeline-card card${s.checked_in ? ' is-done' : ''}`}>
                <div className="timeline-card-head">
                  <strong>{s.class_name}</strong>
                  <span className={`badge ${s.checked_in ? 'badge-present' : 'badge-pending'}`}>
                    {s.checked_in ? t('today.checkedIn') : t('today.notCheckedIn')}
                  </span>
                </div>
                <div className="today-time-chip">
                  <Icon name="clock" size={15} />
                  {s.date.slice(11, 16) || formatDate(s.date)}
                </div>
                <div className="muted today-topic">{formatDateTime(s.date)}</div>
                {s.topic && <div className="muted today-topic">{t('today.topic', { topic: s.topic })}</div>}
                <div className="today-attendance">
                  <Icon name="users" size={14} />
                  {t('today.attendanceCount', { count: s.attendance_count })}
                </div>
                <div>
                  <Link
                    className="btn btn-primary btn-block today-attend-btn"
                    to={`/teacher/diem-danh?class=${s.class_id}&session=${s.session_id}`}
                  >
                    <Icon name="clipboard" size={18} />
                    {t('today.takeAttendance')}
                    <Icon name="arrow-right" size={16} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="card checkin-hero">
        <h2 className="card-title">{t('checkin.title')}</h2>
        <p className="card-desc">{t('checkin.desc')}</p>
        <form onSubmit={checkin}>
          <Field label={t('checkin.codeLabel')} error={errors.code}>
            <input
              className="text-input mono"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                clear('code');
              }}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
              ref={refFor('code')}
            />
          </Field>
          <button className="btn btn-block btn-lg checkin-submit" type="submit" disabled={checkingIn}>
            {checkingIn && <span className="spinner" aria-hidden="true" />}
            {checkingIn ? t('checkin.submitting') : t('checkin.submit')}
          </button>
        </form>
      </section>
    </div>
  );
}
