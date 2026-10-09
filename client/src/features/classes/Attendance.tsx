import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { classesApi, sessionsApi, ClassItem, SessionItem, AttendanceRow } from './classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './Attendance.css';
import { ATTENDANCE_LABEL, formatDate } from '../../shared/types';

type Status = 'present' | 'absent' | 'late';

export function Attendance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [topic, setTopic] = useState('');
  const [classId, setClassId] = useState(searchParams.get('class') || '');
  const [sessionId, setSessionId] = useState(searchParams.get('session') || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [checkinCode, setCheckinCode] = useState<string | null>(null);
  const [makingCode, setMakingCode] = useState(false);
  const toast = useToast();

  useEffect(() => {
    classesApi
      .list()
      .then((r) => setClasses(r.data.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const loadSessions = useCallback(
    async (cid: string) => {
      if (!cid) {
        setSessions([]);
        return;
      }
      try {
        const s = await sessionsApi.listByClass(cid);
        setSessions(s);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không tải được buổi học', 'error');
      }
    },
    [toast]
  );

  useEffect(() => {
    if (classId) void loadSessions(classId);
  }, [classId, loadSessions]);

  const loadAttendance = useCallback(
    async (sid: string) => {
      if (!sid) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const data = await sessionsApi.getAttendance(sid);
        setRows(data.students);
        setTopic(data.session.topic || '');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không tải được điểm danh', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (sessionId) void loadAttendance(sessionId);
  }, [sessionId, loadAttendance]);

  const pickClass = (cid: string) => {
    setClassId(cid);
    setSessionId('');
    setRows([]);
    const p = new URLSearchParams(searchParams);
    if (cid) p.set('class', cid);
    else p.delete('class');
    p.delete('session');
    setSearchParams(p, { replace: true });
  };

  const pickSession = (sid: string) => {
    setSessionId(sid);
    const p = new URLSearchParams(searchParams);
    if (sid) p.set('session', sid);
    else p.delete('session');
    setSearchParams(p, { replace: true });
  };

  const setStatus = (studentId: number, status: Status) => {
    setRows((prev) => prev.map((r) => (r.id === studentId ? { ...r, status } : r)));
  };
  const setNote = (studentId: number, note: string) => {
    setRows((prev) => prev.map((r) => (r.id === studentId ? { ...r, note } : r)));
  };
  const markAll = (status: Status) => {
    setRows((prev) => prev.map((r) => ({ ...r, status })));
  };

  const save = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await sessionsApi.updateTopic(sessionId, topic);
      await sessionsApi.saveAttendance(
        sessionId,
        rows.map((r) => ({ student_id: r.id, status: r.status || 'present', note: r.note || '' }))
      );
      toast('Đã lưu điểm danh', 'success');
      void loadSessions(classId);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    } finally {
      setSaving(false);
    }
  };

  const presentCount = rows.filter((r) => (r.status || 'present') === 'present').length;
  const lateCount = rows.filter((r) => r.status === 'late').length;
  const absentCount = rows.filter((r) => r.status === 'absent').length;

  const makeCheckinCode = async () => {
    if (!sessionId) return;
    setMakingCode(true);
    try {
      const r = await sessionsApi.generateCheckinCode(sessionId);
      setCheckinCode(r.code);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo mã thất bại', 'error');
    } finally {
      setMakingCode(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Điểm danh" desc="Chọn lớp và buổi học, sau đó ghi nhận trạng thái từng học viên" />

      <div className="toolbar">
        <select className="text-input" value={classId} onChange={(e) => pickClass(e.target.value)}>
          <option value="">- Chọn lớp học -</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="text-input"
          value={sessionId}
          onChange={(e) => pickSession(e.target.value)}
          disabled={!classId}
        >
          <option value="">- Chọn buổi học -</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {formatDate(s.date)}
              {s.topic ? ` - ${s.topic}` : ''} ({s.attendance_count || 0} đã điểm danh)
            </option>
          ))}
        </select>
        {classId && (
          <button className="btn" onClick={() => setShowNewSession(true)}>
            <Icon name="plus" size={14} />
            Tạo buổi mới
          </button>
        )}
      </div>

      {sessionId && (
        <>
          <div className="card">
            <Field label="Chủ đề buổi học">
              <input
                className="text-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="VD: Thì hiện tại đơn..."
              />
            </Field>
            <div className="toolbar toolbar-tight">
              <button className="btn btn-sm" onClick={() => markAll('present')}>
                Tất cả có mặt
              </button>
              <button className="btn btn-sm" onClick={() => void makeCheckinCode()} disabled={makingCode}>
                {makingCode ? 'Đang tạo...' : 'Tạo mã điểm danh'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="att-list" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="att-item">
                  <div className="att-item-main">
                    <Skeleton width="40%" height={15} />
                    <div style={{ marginTop: 6 }}>
                      <Skeleton width="25%" height={12} />
                    </div>
                  </div>
                  <Skeleton width={220} height={44} radius={8} />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có học viên để điểm danh"
              desc="Lớp này chưa có học viên nào được ghi danh."
            />
          ) : (
            <>
              <div className="att-list">
                {rows.map((r) => {
                  const st = (r.status || 'present') as Status;
                  return (
                    <div key={r.id} className={`att-item${st === 'present' ? '' : ` att-${st}`}`}>
                      <div className="att-item-main">
                        <div className="att-item-name">{r.name}</div>
                        <div className="att-item-code mono muted">{r.code}</div>
                      </div>
                      <div className="seg seg-lg" role="radiogroup" aria-label={`Trạng thái của ${r.name}`}>
                        {(['present', 'late', 'absent'] as Status[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={st === s}
                            className={`seg-btn seg-${s}${st === s ? ' active' : ''}`}
                            onClick={() => setStatus(r.id, s)}
                          >
                            {ATTENDANCE_LABEL[s]}
                          </button>
                        ))}
                      </div>
                      <input
                        className="text-input input-sm att-note"
                        value={r.note || ''}
                        onChange={(e) => setNote(r.id, e.target.value)}
                        placeholder="Ghi chú..."
                        aria-label={`Ghi chú cho ${r.name}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="att-savebar">
                <span className="att-summary">
                  <span>
                    <span className="num">{rows.length}</span> học viên
                  </span>
                  <span>
                    <span className="num">{presentCount}</span> có mặt
                  </span>
                  {lateCount > 0 && (
                    <span className="sum-late">
                      <span className="num">{lateCount}</span> muộn
                    </span>
                  )}
                  {absentCount > 0 && (
                    <span className="sum-absent">
                      <span className="num">{absentCount}</span> vắng
                    </span>
                  )}
                </span>
                <span className="spacer" />
                <button className="btn btn-primary btn-lg" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu điểm danh'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {showNewSession && classId && (
        <NewSessionModal
          classId={Number(classId)}
          onClose={() => setShowNewSession(false)}
          onCreated={(id) => {
            setShowNewSession(false);
            void loadSessions(classId).then(() => pickSession(String(id)));
          }}
        />
      )}

      {checkinCode && (
        <Modal title="Mã chấm công" onClose={() => setCheckinCode(null)}>
          <p className="confirm-text">
            Giáo viên nhập mã này trong trang "Buổi dạy hôm nay" {'>'} "Chấm công" để ghi nhận điểm danh.
          </p>
          <div className="checkin-code">{checkinCode}</div>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setCheckinCode(null)}>
              Đóng
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewSessionModal({
  classId,
  onClose,
  onCreated,
}: {
  classId: number;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const [date, setDate] = useState(iso);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await sessionsApi.create(classId, date, topic);
      toast('Đã tạo buổi học', 'success');
      onCreated(s.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tạo buổi học mới" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Ngày *">
            <input
              className="text-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Chủ đề">
            <input className="text-input" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang tạo...' : 'Tạo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
