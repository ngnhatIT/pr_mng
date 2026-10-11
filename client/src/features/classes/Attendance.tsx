import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { classesApi, sessionsApi, ClassItem, SessionItem, AttendanceRow } from './classes.api';
import { useMyPermissions } from '../system/roles.api';
import { useUnsavedGuard } from '../../shared/hooks/useUnsavedGuard';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { useLoad } from '../../shared/hooks/useLoad';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './Attendance.css';
import { formatDate, todayVN } from '../../shared/types';
import { fetchAllPages } from '../../shared/components/Pagination';

type Status = 'present' | 'absent' | 'late';

export function Attendance() {
  const { t } = useTranslation(['classes', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  // Trang điểm danh dùng chung cho portal giáo viên (/teacher) và quản trị (/app):
  // route /app/classes chỉ tồn tại ở layout quản trị nên ẩn link này với giáo viên
  const isTeacherPortal = location.pathname.startsWith('/teacher');
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
  const [showConfirmUnmarked, setShowConfirmUnmarked] = useState(false);
  const [checkinCode, setCheckinCode] = useState<string | null>(null);
  const [makingCode, setMakingCode] = useState(false);
  // ADM-11: có thay đổi chưa lưu (điểm danh/ghi chú/chủ đề) -> hỏi trước khi đổi lớp/buổi
  const [dirty, setDirty] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  useUnsavedGuard(dirty); // reload/đóng tab khi đã điểm danh mà chưa lưu
  const [loadedTopic, setLoadedTopic] = useState('');
  // ADM-11: buổi đang chọn, để bỏ qua response của buổi cũ về muộn (mạng chậm, về sai thứ tự)
  const sessionRef = useRef(sessionId);
  const toast = useToast();

  // ADM-6: server chặn limit tối đa 100 -> tải đủ mọi trang để dropdown thấy hết lớp.
  // B5-5: lỗi -> LoadError có "Thử lại" (trước chỉ toast, dropdown trống không cách nào tải lại)
  const {
    data: allClasses,
    error: classesError,
    reload: reloadClasses,
  } = useLoad(() => fetchAllPages((p) => classesApi.list('', p)), []);
  const classes = useMemo<ClassItem[]>(
    () => (allClasses ?? []).filter((x) => x.status === 'active'),
    [allClasses]
  );
  useEffect(() => {
    if (classesError) toastApiError(toast, classesError, t('states.loadError', { ns: 'common' }));
  }, [classesError, toast, t]);

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
        toastApiError(toast, err, t('attendance.toast.sessionsError'));
      }
    },
    [toast, t]
  );

  useEffect(() => {
    if (classId) void loadSessions(classId);
  }, [classId, loadSessions]);

  // Ẩn nút quản trị buổi học khi role không có sessions.manage (teacher chỉ được điểm danh).
  // Fail-closed: đang tải/lỗi -> Set rỗng -> không hiện nút (quyền cache chung với Layout).
  const canManageSessions = useMyPermissions().has('sessions.manage');

  const loadAttendance = useCallback(
    async (sid: string) => {
      if (!sid) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const data = await sessionsApi.getAttendance(sid);
        if (sessionRef.current !== sid) return; // response của buổi cũ: bỏ qua
        setRows(data.students);
        setTopic(data.session.topic || '');
        setLoadedTopic(data.session.topic || '');
        setDirty(false);
      } catch (err) {
        if (sessionRef.current !== sid) return;
        toastApiError(toast, err, t('attendance.toast.attendanceError'));
      } finally {
        if (sessionRef.current === sid) setLoading(false);
      }
    },
    [toast, t]
  );

  useEffect(() => {
    if (sessionId) void loadAttendance(sessionId);
  }, [sessionId, loadAttendance]);

  // Có thay đổi chưa lưu thì hỏi xác nhận trước khi chuyển (ADM-11)
  const guardSwitch = (fn: () => void) => {
    if (dirty) setPendingSwitch(() => fn);
    else fn();
  };

  const pickClass = (cid: string) => {
    sessionRef.current = '';
    setDirty(false);
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
    sessionRef.current = sid;
    setDirty(false);
    setRows([]); // không để điểm danh buổi cũ hiện (và bị lưu) dưới tên buổi mới trong lúc đang tải
    setSessionId(sid);
    setRowSearch('');
    const p = new URLSearchParams(searchParams);
    if (sid) p.set('session', sid);
    else p.delete('session');
    setSearchParams(p, { replace: true });
  };

  const setStatus = (studentId: number, status: Status) => {
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.id === studentId ? { ...r, status } : r)));
  };
  const setNote = (studentId: number, note: string) => {
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.id === studentId ? { ...r, note } : r)));
  };
  const markAll = (status: Status) => {
    setDirty(true);
    setRows((prev) => prev.map((r) => ({ ...r, status })));
  };

  // Học viên chưa tick = chưa điểm danh (null), không mặc định "có mặt" để tránh ghi sai
  const save = async () => {
    if (!sessionId) return;
    const sid = sessionId;
    setSaving(true);
    setSaveError(''); // điểm danh đã chọn giữ nguyên, lỗi hiện ngay trong savebar
    try {
      // ADM-1: lưu điểm danh TRƯỚC (attendance.take); chủ đề cần sessions.manage nên chỉ gọi khi có quyền
      // và chủ đề thực sự đổi -> giáo viên không bị 403 chặn mất điểm danh.
      await sessionsApi.saveAttendance(
        sid,
        rows
          .filter((r) => r.status != null)
          .map((r) => ({ student_id: r.id, status: r.status as Status, note: r.note || '' }))
      );
      if (canManageSessions && topic !== loadedTopic) {
        await sessionsApi.updateTopic(sid, topic);
        setLoadedTopic(topic);
      }
      setDirty(false);
      toast(t('attendance.toast.saved'), 'success');
      void loadSessions(classId);
    } catch (err) {
      // Lỗi lưu hiện inline trong savebar, ngay cạnh nút lưu (skill 8.2)
      setSaveError(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }));
    } finally {
      setSaving(false);
    }
  };

  // Còn người chưa tick thì hỏi xác nhận trước khi ghi, tránh lưu thiếu
  const trySave = () => {
    if (!sessionId) return;
    if (unmarkedCount > 0) setShowConfirmUnmarked(true);
    else void save();
  };
  const confirmSave = () => {
    setShowConfirmUnmarked(false);
    void save();
  };

  const markedCount = rows.filter((r) => r.status != null).length;
  const unmarkedCount = rows.length - markedCount;
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
      toastApiError(toast, err, t('attendance.checkin.createError'));
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
          onChange={(e) => {
            const v = e.target.value;
            guardSwitch(() => pickClass(v));
          }}
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
          onChange={(e) => {
            const v = e.target.value;
            guardSwitch(() => pickSession(v));
          }}
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
        {classId && canManageSessions && (
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

      {!!classesError && !allClasses && <LoadError onRetry={reloadClasses} />}

      {sessionId ? (
        <>
          <div className="card">
            <Field label={t('attendance.topic.label')}>
              <input
                className="text-input"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  setDirty(true);
                }}
                placeholder={t('attendance.topic.placeholder')}
                // Giáo viên (không có sessions.manage) không sửa được chủ đề buổi
                readOnly={!canManageSessions}
              />
            </Field>
            <div className="toolbar toolbar-tight">
              <button className="btn btn-sm" onClick={() => markAll('present')}>
                {t('attendance.toolbar.allPresent')}
              </button>
              {canManageSessions && (
                <button className="btn btn-sm" onClick={() => void makeCheckinCode()} disabled={makingCode}>
                  {makingCode && <span className="spinner spinner-dark" aria-hidden="true" />}
                  {makingCode ? t('attendance.toolbar.creatingCode') : t('attendance.toolbar.createCode')}
                </button>
              )}
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
                !isTeacherPortal && (
                  <Link className="btn btn-primary btn-inline" to={`/app/classes/${classId}`}>
                    <Icon name="plus" size={14} />
                    {t('detail.enroll.add')}
                  </Link>
                )
              }
            />
          ) : (
            <>
              <div className="att-list" aria-busy={loading || undefined}>
                {visibleRows.map((r) => {
                  const st = r.status as Status | null;
                  return (
                    <div key={r.id} className={`att-item${st && st !== 'present' ? ` att-${st}` : ''}`}>
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
                  <span>{t('attendance.summary.marked', { marked: markedCount, total: rows.length })}</span>
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
                <button className="btn btn-primary btn-lg" onClick={trySave} disabled={saving}>
                  {saving && <span className="spinner" aria-hidden="true" />}
                  {saving ? t('actions.saving', { ns: 'common' }) : t('attendance.save')}
                </button>
              </div>
              {showConfirmUnmarked && (
                <ConfirmDialog
                  title={t('attendance.confirmUnmarked.title')}
                  message={t('attendance.confirmUnmarked.message', { count: unmarkedCount })}
                  onClose={() => setShowConfirmUnmarked(false)}
                  onConfirm={confirmSave}
                />
              )}
            </>
          )}
        </>
      ) : (
        <EmptyState icon="clipboard" title={t('attendance.startTitle')} desc={t('attendance.startDesc')} />
      )}

      {showNewSession && classId && (
        <NewSessionModal
          classId={Number(classId)}
          onClose={() => setShowNewSession(false)}
          onCreated={(id) => {
            setShowNewSession(false);
            void loadSessions(classId).then(() => guardSwitch(() => pickSession(String(id))));
          }}
        />
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title={t('attendance.discard.title')}
          message={t('attendance.discard.message')}
          danger
          onClose={() => setPendingSwitch(null)}
          onConfirm={() => {
            const fn = pendingSwitch;
            setPendingSwitch(null);
            fn();
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
  const [date, setDate] = useState(todayVN);
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
    <Modal
      title={t('attendance.newSession.title')}
      onClose={onClose}
      dirty={topic !== '' || date !== todayVN()}
    >
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
