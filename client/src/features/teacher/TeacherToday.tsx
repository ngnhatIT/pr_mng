import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { teacherApi } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { TeacherTodayItem, formatDate } from '../../shared/types';

export function TeacherToday() {
  const [sessions, setSessions] = useState<TeacherTodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teacherApi.today();
      setSessions(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được lịch dạy', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      toast('Mã chấm công gồm 6 chữ số', 'error');
      return;
    }
    setCheckingIn(true);
    try {
      const r = await teacherApi.checkin(code.trim());
      toast(`Chấm công thành công: ${r.class_name} — ${formatDate(r.date)}`, 'success');
      setCode('');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Chấm công thất bại', 'error');
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Buổi dạy hôm nay" desc="Lịch dạy, điểm danh lớp và chấm công của bạn" />

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
        <EmptyState
          icon="calendar"
          title="Hôm nay không có buổi dạy"
          desc="Lịch dạy của bạn sẽ hiện ở đây khi được phân công."
        />
      ) : (
        <div className="timeline">
          {sessions.map((s) => (
            <div key={s.session_id} className="timeline-item">
              <div className={`timeline-dot${s.checked_in ? ' done' : ''}`}>
                {s.checked_in && <Icon name="check" size={12} />}
              </div>
              <div className="timeline-card card">
                <div className="timeline-card-head">
                  <strong>{s.class_name}</strong>
                  <span className={`badge ${s.checked_in ? 'badge-present' : 'badge-pending'}`}>
                    {s.checked_in ? 'Đã chấm công' : 'Chưa chấm công'}
                  </span>
                </div>
                <div className="muted">
                  {formatDate(s.date)}
                  {s.topic ? ` · ${s.topic}` : ''}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {s.attendance_count} học viên đã điểm danh
                </div>
                <div style={{ marginTop: 10 }}>
                  <Link
                    className="btn btn-sm btn-primary"
                    to={`/teacher/diem-danh?class=${s.class_id}&session=${s.session_id}`}
                  >
                    Điểm danh lớp
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="card checkin-hero">
        <h2 className="card-title">Chấm công</h2>
        <p className="card-desc">Nhập mã 6 số do quản lý cấp cho buổi dạy để ghi nhận chấm công.</p>
        <form onSubmit={checkin}>
          <Field label="Mã chấm công (6 số)">
            <input
              className="text-input mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
            />
          </Field>
          <button
            className="btn btn-block btn-lg"
            type="submit"
            disabled={checkingIn}
            style={{ background: '#fff', color: '#1d4ed8', borderColor: '#fff', fontWeight: 700 }}
          >
            {checkingIn ? 'Đang chấm công...' : 'Chấm công ngay'}
          </button>
        </form>
      </section>
    </div>
  );
}
