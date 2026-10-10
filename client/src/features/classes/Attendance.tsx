import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { classesApi, sessionsApi, ClassItem, SessionItem, AttendanceRow } from './classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './Attendance.css';
import { formatDate } from '../../shared/types';

type Status = 'present' | 'absent' | 'late';

export function Attendance() {
  const { t } = useTranslation(['classes', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [topic, setTopic] = useState('');
  const [classId, setClassId] = useState(searchParams.get('class') || '');
  const [sessionId, setSessionId] = useState(searchParams.get('session') || '');
  const [rowSearch, setRowSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);
  const [checkinCode, setCheckinCode] = useState<string | null>(null);
  const [makingCode, setMakingCode] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // MEDIUM-4: dropdown lớp phải thấy hết lớp, không chỉ 20 lớp đầu (default limit)
    classesApi
      .list("", { limit: 200 })
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
        toast(err instanceof Error ? err.message : t('attendance.toast.sessionsError'), 'error');
      }
    },
    [toast, t]
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
        toast(err instanceof Error ? err.message : t('attendance.toast.attendanceError'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast, t]
  );

  useEffect(() => {
    if (sessionId) void loadAttendance(sessionId);
  }, [sessionId, loadAttendance]);

  const pickClass = (cid: string) => {
    setClassId(cid);
    setSessionId('');
    setRows([]);
    setRowSearch('');
    const p = new URLSearchParams(searchParams);
    if (cid) p.set('class', cid);
    else p.delete('class');
    p.delete('session');
    setSearchParams(p, { replace: true });
  };

  const pickSession = (sid: string) => {
    setSessionId(sid);
    setRowSearch('');
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
    setSaveError(''); // điểm danh đã chọn giữ nguyên, lỗi hiện ngay trong savebar
    try {
      await sessionsApi.updateTopic(sessionId, topic);
      await sessionsApi.saveAttendance(
        sessionId,
        rows.map((r) => ({ student_id: r.id, status: r.status || 'present', note: r.note || '' }))
      );
      toast(t('attendance.toast.saved'), 'success');
      void loadSessions(classId);
    } catch (err) {
      // Lỗi lưu hiện inline trong savebar, ngay cạnh nút lưu (skill 8.2)
      setSaveError(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }));
    } finally {
      setSaving(false);
    }
  };

  const presentCount = rows.filter((r) => (r.status || 'present') === 'present').length;
  const lateCount = rows.filter((r) => r.status === 'late').length;
  const absentCount = rows.filter((r) => r.status === 'absent').length;

  // Lọc tức thì trên danh sách đã tải (không gọi API): tìm theo tên hoặc mã học viên
  const q = rowSearch.trim().toLowerCase();
  const visibleRows = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
    : rows;

  const makeCheckinCode = async () => {
    if (!sessionId) return;
    setMakingCode(true);
    try {
      const r = await sessionsApi.generateCheckinCode(sessionId);
      setCheckinCode(r.code);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('attendance.checkin.createError'), 'error');
    } finally {
      setMakingCode(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('attendance.title')} desc={t('attendance.desc')} />

      <div className="toolbar att-toolbar">
        <select
          className="text-input"
          value={classId}
          onChange={(e) => pickClass(e.target.value)}
          aria-label={t('attendance.selectClass')}
        >
          <option value="">{t('attendance.selectClass')}</option>
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
          aria-label={t('attendance.selectSession')}
        >
          <option value="">{t('attendance.selectSession')}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {t('attendance.sessionOption', {
                date: formatDate(s.date),
                topic: s.topic ? ` - ${s.topic}` : '',
                count: s.attendance_count || 0,
              })}
            </option>
          ))}
        </select>
        {classId && (
          <button className="btn btn-inline" onClick={() => setShowNewSession(true)}>
            <Icon name="plus" size={14} />
            {t('attendance.createSession')}
          </button>
        )}
        {sessionId && (
          <span className={`search-wrap${rowSearch ? ' has-clear' : ''}`}>
            <span className="search-icon">
              <Icon name="search" size={15} />
            </span>
            <input
              className="text-input search-input"
              aria-label={t('attendance.searchPlaceholder')}
              placeholder={t('attendance.searchPlaceholder')}
              value={rowSearch}
              onChange={(e) => setRowSearch(e.target.value)}
            />
            {rowSearch !== '' && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setRowSearch('')}
                aria-label={t('attendance.clearSearch')}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </span>
        )}
      </div>

      {sessionId ? (
        <>
          <div className="card">
            <Field label={t('attendance.topic.label')}>
              <input
                className="text-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t('attendance.topic.placeholder')}
              />
            </Field>
            <div className="toolbar toolbar-tight">
              <button className="btn btn-sm" onClick={() => markAll('present')}>
                {t('attendance.toolbar.allPresent')}
              </button>
              <button className="btn btn-sm" onClick={() => void makeCheckinCode()} disabled={makingCode}>
                {makingCode && <span className="spinner spinner-dark" aria-hidden="true" />}
                {makingCode ? t('attendance.toolbar.creatingCode') : t('attendance.toolbar.createCode')}
              </button>
            </div>
          </div>

          {loading && rows.length === 0 ? (
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
              title={t('attendance.emptyTitle')}
              desc={t('attendance.emptyDesc')}
              action={
                <Link className="btn btn-primary btn-inline" to={`/app/classes/${classId}`}>
                  <Icon name="plus" size={14} />
                  {t('detail.enroll.add')}
                </Link>
              }
            />
          ) : (
            <>
              <div className="att-list" aria-busy={loading || undefined}>
                {visibleRows.map((r) => {
                  const st = (r.status || 'present') as Status;
                  return (
                    <div key={r.id} className={`att-item${st === 'present' ? '' : ` att-${st}`}`}>
                      <div className="att-item-main">
                        <div className="att-item-name">{r.name}</div>
                        <div className="att-item-code mono muted">{r.code}</div>
                      </div>
                      <div
                        className="seg seg-lg"
                        role="radiogroup"
                        aria-label={t('attendance.row.statusAria', { name: r.name })}
                      >
                        {(['present', 'late', 'absent'] as Status[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={st === s}
                            className={`seg-btn seg-${s}${st === s ? ' active' : ''}`}
                            onClick={() => setStatus(r.id, s)}
                          >
                            {t('attendance.status.' + s)}
                          </button>
                        ))}
                      </div>
                      <input
                        className="text-input input-sm att-note"
                        value={r.note || ''}
                        onChange={(e) => setNote(r.id, e.target.value)}
                        placeholder={t('attendance.row.notePlaceholder')}
                        aria-label={t('attendance.row.noteAria', { name: r.name })}
                      />
                    </div>
                  );
                })}
              </div>
              {visibleRows.length === 0 && rows.length > 0 && (
                <p className="muted att-no-match">{t('attendance.noMatch')}</p>
              )}
              <div className="att-savebar">
                <span className="att-summary">
                  <span>
                    <span className="num">{rows.length}</span> {t('attendance.summary.students')}
                  </span>
                  <span>
                    <span className="num">{presentCount}</span> {t('attendance.summary.present')}
                  </span>
                  {lateCount > 0 && (
                    <span className="sum-late">
                      <span className="num">{lateCount}</span> {t('attendance.summary.late')}
                    </span>
                  )}
                  {absentCount > 0 && (
                    <span className="sum-absent">
                      <span className="num">{absentCount}</span> {t('attendance.summary.absent')}
                    </span>
                  )}
                </span>
                <span className="spacer" />
                {saveError && (
                  <span className="field-error" role="alert">
                    {saveError}
                  </span>
                )}
                <button className="btn btn-primary btn-lg" onClick={() => void save()} disabled={saving}>
                  {saving && <span className="spinner" aria-hidden="true" />}
                  {saving ? t('actions.saving', { ns: 'common' }) : t('attendance.save')}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <EmptyState
          icon="clipboard"
          title={t('attendance.startTitle')}
          desc={t('attendance.startDesc')}
        />
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
        <Modal title={t('attendance.checkin.codeTitle')} onClose={() => setCheckinCode(null)}>
          <p className="confirm-text">{t('attendance.checkin.help')}</p>
          <div className="checkin-code">{checkinCode}</div>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setCheckinCode(null)}>
              {t('attendance.checkin.close')}
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
  const { t } = useTranslation(['classes', 'common']);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const [date, setDate] = useState(iso);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { errors, refFor, show, clear } = useFieldErrors<'date'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!show(date ? {} : { date: t('attendance.newSession.dateRequired') })) return;
    setBusy(true);
    try {
      const s = await sessionsApi.create(classId, date, topic);
      toast(t('attendance.toast.created'), 'success');
      onCreated(s.id);
    } catch (err) {
      // Lỗi tạo buổi (vd trùng ngày) hiện inline dưới ô ngày, giữ lại dữ liệu đã nhập
      show({ date: err instanceof Error ? err.message : t('attendance.toast.createError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('attendance.newSession.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('attendance.newSession.date')} error={errors.date}>
            <input
              className="text-input"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                clear('date');
              }}
              ref={refFor('date')}
            />
          </Field>
          <Field label={t('attendance.newSession.topic')}>
            <input className="text-input" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('attendance.newSession.creating') : t('attendance.newSession.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
