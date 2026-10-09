import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { classesApi, sessionsApi, SessionItem, EnrolledStudent } from './classes.api';
import type { ClassDetail as ClassDetailData } from './classes.api';
import { studentsApi, Student } from '../students/students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { formatVND, formatDate, formatScheduleText } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './ClassDetail.css';

export function ClassDetail() {
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
      toast(err instanceof Error ? err.message : 'Không tải được chi tiết lớp', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const kick = async () => {
    if (!kicking) return;
    try {
      await classesApi.unenroll(kicking.enrollment_id);
      toast('Đã xóa học viên khỏi lớp', 'success');
      setKicking(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  if (loading)
    return (
      <div className="page">
        <div className="profile-head" aria-hidden="true">
          <Skeleton width={64} height={64} radius={18} />
          <div style={{ flex: 1 }}>
            <Skeleton width="40%" height={24} radius={8} />
            <div style={{ marginTop: 10 }}>
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
        <EmptyState icon="book" title="Không tìm thấy lớp học" desc="Lớp học không tồn tại hoặc đã bị xóa." />
      </div>
    );
  const { class: cls } = data;

  return (
    <div className="page">
      <Link className="link back-link" to="/app/classes">
        <Icon name="arrow-right" size={14} className="flip-x" />
        Danh sách lớp học
      </Link>
      <div className="profile-head">
        <div className="profile-avatar">{cls.name.charAt(0).toUpperCase()}</div>
        <div className="profile-meta">
          <h1 className="page-title">{cls.name}</h1>
          <div className="profile-badges">
            <span className={`badge badge-${cls.status}`}>
              {cls.status === 'active' ? 'Đang mở' : 'Đã đóng'}
            </span>
            <span className="badge badge-general">
              {data.students.length}/{cls.max_students} học viên
            </span>
          </div>
        </div>
      </div>

      <section className="card">
        <dl className="dl dl-inline">
          <dt>Giáo viên</dt>
          <dd>{cls.teacher_name || 'Chưa phân công'}</dd>
          <dt>Phòng học</dt>
          <dd>{cls.room_name || 'Chưa gán phòng'}</dd>
          <dt>Lịch học</dt>
          <dd>{formatScheduleText(cls.schedule || '') || '-'}</dd>
          <dt>Thời gian</dt>
          <dd className="num">
            {formatDate(cls.start_date)} - {formatDate(cls.end_date)}
          </dd>
          <dt>Học phí</dt>
          <dd className="num">{formatVND(cls.tuition_fee)}</dd>
          <dt>Sĩ số</dt>
          <dd>
            {data.students.length}/{cls.max_students}
          </dd>
          <dt>Số buổi học</dt>
          <dd>{data.sessionCount}</dd>
        </dl>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Học viên ({data.students.length})</h2>
            <button className="btn btn-sm btn-primary" onClick={() => setShowEnroll(true)}>
              <Icon name="plus" size={13} />
              Thêm học viên
            </button>
          </div>
          {data.students.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có học viên nào"
              desc="Thêm học viên vào lớp để bắt đầu điểm danh."
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
                    Xóa khỏi lớp
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Buổi học gần đây</h2>
            <Link className="link link-arrow" to={`/app/attendance?class=${cls.id}`}>
              Điểm danh
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          {sessions.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Chưa có buổi học nào"
              desc="Buổi học sẽ tự sinh từ lịch học của lớp."
            />
          ) : (
            <ul className="list">
              {sessions
                .slice(-6)
                .reverse()
                .map((s) => (
                  <li key={s.id} className="list-item">
                    <div>
                      <div className="list-title">{formatDate(s.date)}</div>
                      <div className="list-sub">
                        {s.topic || 'Chưa có chủ đề'} · {s.attendance_count || 0} lượt điểm danh
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {showEnroll && (
        <EnrollModal
          classId={cls.id}
          onClose={() => setShowEnroll(false)}
          onDone={() => {
            setShowEnroll(false);
            void load();
          }}
        />
      )}
      {kicking && (
        <ConfirmDialog
          title="Xóa khỏi lớp"
          message={`Xóa học viên "${kicking.name}" khỏi lớp "${cls.name}"?`}
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
  onClose,
  onDone,
}: {
  classId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    studentsApi
      .list('', 'studying', { limit: 100 })
      .then((r) => setStudents(r.data))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase())
  );

  const enroll = async (studentId: number) => {
    setBusyId(studentId);
    try {
      await classesApi.enroll(classId, studentId);
      toast('Đã thêm học viên vào lớp', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thêm thất bại', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title="Thêm học viên vào lớp" onClose={onClose}>
      <Field label="Tìm học viên">
        <input
          className="text-input"
          placeholder="Nhập tên hoặc mã..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              {busyId === s.id ? 'Đang thêm...' : 'Thêm'}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">Không tìm thấy học viên.</li>}
      </ul>
    </Modal>
  );
}
