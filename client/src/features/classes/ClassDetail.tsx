import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { classesApi, sessionsApi, SessionItem, EnrolledStudent } from './classes.api';
import type { ClassDetail as ClassDetailData } from './classes.api';
import { studentsApi, Student } from '../students/students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { formatVND, formatDate } from '../../shared/types';
import type { ScheduleEntry } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './ClassDetail.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

export function ClassDetail() {
  const { t } = useTranslation(['classes', 'common']);
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClassDetailData | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [kicking, setKicking] = useState<EnrolledStudent | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, sess] = await Promise.all([classesApi.get(id || ''), sessionsApi.listByClass(id || '')]);
      setData(d);
      setSessions(sess);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('detail.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const kick = async () => {
    if (!kicking) return;
    try {
      await classesApi.unenroll(kicking.enrollment_id);
      toast(t('detail.kick.removed'), 'success');
      setKicking(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    }
  };

  /** Localized schedule text (shared formatScheduleText is Vietnamese-only) */
  const formatSchedule = (scheduleJson: string) => {
    try {
      const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
      return s.map((e) => `${t('days.' + e.day)} ${e.start}-${e.end}`).join(', ');
    } catch {
      return '';
    }
  };

  if (loading)
    return (
      <div className="page">
        <div className="profile-head" aria-hidden="true">
          <Skeleton width={64} height={64} radius={18} />
          <div style={{ flex: 1 }}>
            <Skeleton width="40%" height={24} radius={8} />
            <div style={{ marginTop: 8 }}>
              <Skeleton width="25%" height={14} />
            </div>
          </div>
        </div>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <Skeleton height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="80%" height={14} />
          </div>
        </section>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <Skeleton height={14} />
          </div>
        </section>
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <EmptyState icon="book" title={t('detail.notFoundTitle')} desc={t('detail.notFoundDesc')} />
      </div>
    );
  const { class: cls } = data;

  return (
    <div className="page">
      <Link className="link back-link" to="/app/classes">
        <Icon name="arrow-right" size={14} className="flip-x" />
        {t('detail.back')}
      </Link>
      <div className="profile-head">
        <div className="profile-avatar" aria-hidden="true">
          <Icon name="book" size={28} />
        </div>
        <div className="profile-meta">
          <h1 className="page-title">{cls.name}</h1>
          <div className="profile-badges">
            <span className={`badge badge-${cls.status}`}>{t('classStatus.' + cls.status)}</span>
            <span className="badge badge-general">
              {t('detail.sizeBadge', { count: data.students.length, max: cls.max_students })}
            </span>
          </div>
        </div>
      </div>

      <section className="card">
        <dl className="dl dl-inline">
          <dt>{t('detail.teacher')}</dt>
          <dd>{cls.teacher_name || t('detail.noTeacher')}</dd>
          <dt>{t('detail.room')}</dt>
          <dd>{cls.room_name || t('detail.noRoom')}</dd>
          <dt>{t('detail.schedule')}</dt>
          <dd>{formatSchedule(cls.schedule || '') || <EmptyCell />}</dd>
          <dt>{t('detail.dateRange')}</dt>
          <dd className="num">
            {formatDate(cls.start_date)} - {formatDate(cls.end_date)}
          </dd>
          <dt>{t('detail.tuition')}</dt>
          <dd className="num">{formatVND(cls.tuition_fee)}</dd>
          <dt>{t('detail.size')}</dt>
          <dd>
            {data.students.length}/{cls.max_students}
          </dd>
          <dt>{t('detail.sessionCount')}</dt>
          <dd>{data.sessionCount}</dd>
        </dl>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>{t('detail.studentsTitle', { count: data.students.length })}</h2>
            <button className="btn btn-sm btn-primary btn-inline" onClick={() => setShowEnroll(true)}>
              <Icon name="plus" size={13} />
              {t('detail.enroll.add')}
            </button>
          </div>
          {data.students.length === 0 ? (
            <EmptyState
              icon="users"
              title={t('detail.emptyStudentsTitle')}
              desc={t('detail.emptyStudentsDesc')}
              action={
                <button className="btn btn-primary btn-inline" onClick={() => setShowEnroll(true)}>
                  <Icon name="plus" size={14} />
                  {t('detail.enroll.add')}
                </button>
              }
            />
          ) : (
            <ul className="list">
              {data.students.map((s) => (
                <li key={s.id} className="list-item">
                  <div>
                    <Link className="link" to={`/app/students/${s.id}`}>
                      {s.name}
                    </Link>{' '}
                    <span className="muted mono">({s.code})</span>
                    <div className="list-sub">{s.phone || ''}</div>
                  </div>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setKicking(s)}>
                    <Icon name="trash" size={14} />
                    {t('detail.kick.removeFromClass')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('detail.recentSessions')}</h2>
            <Link className="link link-arrow" to={`/app/attendance?class=${cls.id}`}>
              {t('attendance.title')}
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {sessions.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={t('detail.emptySessionsTitle')}
              desc={t('detail.emptySessionsDesc')}
              action={
                <Link className="btn btn-primary btn-inline" to={`/app/attendance?class=${cls.id}`}>
                  {t('attendance.title')}
                  <Icon name="arrow-right" size={14} />
                </Link>
              }
            />
          ) : (
            <ul className="list">
              {sessions
                .slice(-6)
                .reverse()
                .map((s) => (
                  <li key={s.id} className="list-item">
                    <div>
                      <Link className="link" to={`/app/attendance?class=${cls.id}&session=${s.id}`}>
                        {formatDate(s.date)}
                      </Link>
                      <div className="list-sub">
                        {s.topic || t('detail.noTopic')}
                        <span className="muted">
                          {' '}
                          {t('detail.attendanceCount', { count: s.attendance_count || 0 })}
                        </span>
                      </div>
                    </div>
                    <Link
                      className="btn btn-sm btn-inline"
                      to={`/app/attendance?class=${cls.id}&session=${s.id}`}
                    >
                      <Icon name="clipboard" size={14} />
                      {t('detail.takeAttendance')}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {showEnroll && (
        <EnrollModal
          classId={cls.id}
          enrolledIds={data.students.map((s) => s.id)}
          onClose={() => setShowEnroll(false)}
          onDone={() => {
            setShowEnroll(false);
            void load();
          }}
        />
      )}
      {kicking && (
        <ConfirmDialog
          title={t('detail.kick.confirmTitle')}
          message={t('detail.kick.confirmMessage', { student: kicking.name, class: cls.name })}
          onClose={() => setKicking(null)}
          onConfirm={kick}
          danger
        />
      )}
    </div>
  );
}

function EnrollModal({
  classId,
  enrolledIds,
  onClose,
  onDone,
}: {
  classId: number;
  enrolledIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['classes', 'common']);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();
  // Ẩn học viên đã ghi danh khỏi danh sách để không bấm Thêm rồi nhận lỗi khó hiểu
  const enrolled = new Set(enrolledIds);

  useEffect(() => {
    studentsApi
      .list('', 'studying', { limit: 100 })
      .then((r) => setStudents(r.data))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const filtered = students.filter(
    (s) =>
      !enrolled.has(s.id) &&
      (s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.code.toLowerCase().includes(search.toLowerCase()))
  );

  const enroll = async (studentId: number) => {
    setBusyId(studentId);
    try {
      await classesApi.enroll(classId, studentId);
      toast(t('detail.enroll.added'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('detail.enroll.addError'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title={t('detail.enroll.title')} onClose={onClose}>
      <Field label={t('detail.enroll.searchLabel')}>
        <span className={`search-wrap enroll-search${search ? ' has-clear' : ''}`}>
          <input
            className="text-input"
            placeholder={t('detail.enroll.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search !== '' && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearch('')}
              aria-label={t('detail.enroll.clearSearch')}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </span>
      </Field>
      <ul className="list list-scroll">
        {filtered.slice(0, 30).map((s) => (
          <li key={s.id} className="list-item">
            <div>
              {s.name} <span className="muted mono">({s.code})</span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              disabled={busyId === s.id}
              onClick={() => void enroll(s.id)}
            >
              {busyId === s.id && <span className="spinner" aria-hidden="true" />}
              {busyId === s.id ? t('detail.enroll.adding') : t('detail.enroll.add')}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">{t('detail.enroll.notFound')}</li>}
      </ul>
    </Modal>
  );
}
