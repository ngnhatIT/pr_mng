import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { sessionsApi, roomsApi, type CalendarItem, type SessionPatch } from './classes.api';
import { peopleApi } from '../people/people.api';
import { useMyPermissions } from '../system/roles.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { LoadError } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { appLocale, formatDate, todayVN } from '../../shared/types';
import { daysBetween, monthGridRange, shiftAnchor, weekRange } from './schedule.dates';
import './Schedule.css';

type View = 'week' | 'month';
type Option = { id: number; name: string };

/** Danh sách cho bộ lọc; thiếu quyền xem (403) thì bỏ bộ lọc đó thay vì báo lỗi cả trang. */
async function optionsOf(load: () => Promise<{ data: Option[] }>): Promise<Option[]> {
  try {
    return (await load()).data.map(({ id, name }) => ({ id, name }));
  } catch {
    return [];
  }
}

export function Schedule() {
  const { t, i18n } = useTranslation(['classes', 'common']);
  const [q, setQ] = useUrlState({ view: 'week', date: '', teacher: '', room: '' });
  const view: View = q.view === 'month' ? 'month' : 'week';
  const today = todayVN();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const range = view === 'week' ? weekRange(anchor) : monthGridRange(anchor);
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const perms = useMyPermissions();
  const canManage = perms.has('sessions.manage');
  const toast = useToast();
  const [open, setOpen] = useState<CalendarItem | null>(null);

  const { data, loading, error, reload } = useLoad(
    () => sessionsApi.calendar({ from: range.from, to: range.to, teacher_id: q.teacher, room_id: q.room }),
    [range.from, range.to, q.teacher, q.room]
  );
  useEffect(() => {
    if (error) toastApiError(toast, error, t('schedule.loadError'));
  }, [error, toast, t]);
  const { data: opts } = useLoad(
    async () => ({
      teachers: await optionsOf(() => peopleApi.listTeachers({ limit: 100 })),
      rooms: await optionsOf(() => roomsApi.list({ limit: 100 })),
    }),
    []
  );
  const teachers = opts?.teachers ?? [];
  const rooms = opts?.rooms ?? [];

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of data ?? []) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return m;
  }, [data]);

  const locale = appLocale(i18n.language);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const dayNum = (iso: string) => Number(iso.slice(8));
  const title =
    view === 'month'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
          new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`)
        )
      : `${formatDate(range.from)} – ${formatDate(range.to)}`;

  const chip = (it: CalendarItem, compact = false) => (
    <button
      key={it.id}
      type="button"
      className={`sched-item${it.substitute ? ' is-sub' : ''}${compact ? ' compact' : ''}`}
      onClick={() => setOpen(it)}
      aria-label={`${it.start ?? ''} ${it.class_name}${it.teacher_name ? `, ${it.teacher_name}` : ''}`}
    >
      <span className="sched-time">
        {compact ? (it.start ?? '–') : it.start ? `${it.start}–${it.end}` : t('schedule.noTime')}
      </span>
      <span className="sched-class">{it.class_name}</span>
      {!compact && (
        <span className="sched-meta">
          {[it.teacher_name, it.room_name].filter(Boolean).join(' · ') || ' '}
        </span>
      )}
      {!compact && (it.substitute || it.rescheduled_from) && (
        <span className="sched-tags">
          {it.substitute && <span className="badge badge-warning">{t('schedule.substitute')}</span>}
          {it.rescheduled_from && <span className="badge badge-neutral">{t('schedule.rescheduled')}</span>}
        </span>
      )}
    </button>
  );

  return (
    <div className="page">
      <PageHeader title={t('schedule.title')} desc={t('schedule.desc')} />

      <div className="toolbar sched-toolbar">
        <div className="lang-seg" role="group" aria-label={t('schedule.viewLabel')}>
          {(['week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`lang-seg-btn${view === v ? ' active' : ''}`}
              aria-pressed={view === v}
              onClick={() => setQ({ view: v })}
            >
              {t(`schedule.view.${v}`)}
            </button>
          ))}
        </div>
        <div className="sched-nav">
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            aria-label={t('schedule.prev')}
            onClick={() => setQ({ date: shiftAnchor(anchor, view, -1) })}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-inline" onClick={() => setQ({ date: '' })}>
            {t('schedule.today')}
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            aria-label={t('schedule.next')}
            onClick={() => setQ({ date: shiftAnchor(anchor, view, 1) })}
          >
            <Icon name="chevron-right" size={16} />
          </button>
          <h2 className="sched-title" aria-live="polite">
            {title}
          </h2>
        </div>
        <span className="spacer" />
        {teachers.length > 0 && (
          <select
            className="text-input"
            aria-label={t('schedule.filterTeacher')}
            value={q.teacher}
            onChange={(e) => setQ({ teacher: e.target.value })}
          >
            <option value="">{t('schedule.allTeachers')}</option>
            {teachers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        {rooms.length > 0 && (
          <select
            className="text-input"
            aria-label={t('schedule.filterRoom')}
            value={q.room}
            onChange={(e) => setQ({ room: e.target.value })}
          >
            <option value="">{t('schedule.allRooms')}</option>
            {rooms.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : loading && !data ? (
        <Skeleton height={420} />
      ) : view === 'week' ? (
        <div className={`sched-week${loading ? ' is-loading' : ''}`}>
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            return (
              <section
                key={d}
                className={`sched-day${d === today ? ' is-today' : ''}`}
                aria-label={formatDate(d)}
              >
                <header className="sched-day-head">
                  <span className="sched-wd">{weekday.format(new Date(`${d}T00:00:00Z`))}</span>
                  <span className="sched-dn">{dayNum(d)}</span>
                </header>
                <div className="sched-day-body">
                  {items.length ? (
                    items.map((it) => chip(it))
                  ) : (
                    <span className="sched-empty">{t('schedule.free')}</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={`sched-month${loading ? ' is-loading' : ''}`}>
          {days.slice(0, 7).map((d) => (
            <div key={d} className="sched-month-wd" aria-hidden="true">
              {weekday.format(new Date(`${d}T00:00:00Z`))}
            </div>
          ))}
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const out = d.slice(0, 7) !== anchor.slice(0, 7);
            return (
              <section
                key={d}
                className={`sched-cell${out ? ' is-out' : ''}${d === today ? ' is-today' : ''}`}
                aria-label={`${formatDate(d)}: ${t('schedule.sessionCount', { count: items.length })}`}
              >
                <span className="sched-dn">{dayNum(d)}</span>
                {items.slice(0, 3).map((it) => chip(it, true))}
                {items.length > 3 && (
                  <button
                    type="button"
                    className="sched-more"
                    onClick={() => setQ({ view: 'week', date: d })}
                  >
                    {t('schedule.more', { count: items.length - 3 })}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}

      {open && (
        <SessionModal
          item={open}
          canManage={canManage}
          teachers={teachers}
          rooms={rooms}
          today={today}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SessionModal({
  item,
  canManage,
  teachers,
  rooms,
  today,
  onClose,
  onChanged,
}: {
  item: CalendarItem;
  canManage: boolean;
  teachers: Option[];
  rooms: Option[];
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation(['classes', 'common']);
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'edit' | 'move'>('view');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [teacher, setTeacher] = useState(String(item.teacher_id ?? ''));
  const [room, setRoom] = useState(String(item.room_id ?? ''));
  const [start, setStart] = useState(item.start ?? '');
  const [end, setEnd] = useState(item.end ?? '');
  const [topic, setTopic] = useState(item.topic ?? '');
  const [date, setDate] = useState(item.date);
  const dirty =
    mode !== 'view' &&
    (teacher !== String(item.teacher_id ?? '') ||
      room !== String(item.room_id ?? '') ||
      start !== (item.start ?? '') ||
      end !== (item.end ?? '') ||
      topic !== (item.topic ?? '') ||
      date !== item.date);

  const run = async (fn: () => Promise<unknown>, okKey: string) => {
    setBusy(true);
    try {
      await fn();
      toast(t(okKey), 'success');
      onChanged();
    } catch (err) {
      toastApiError(toast, err, t('states.saveError', { ns: 'common' }));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'move') {
      void run(
        () =>
          sessionsApi.reschedule(item.id, {
            date,
            start_time: start || undefined,
            end_time: end || undefined,
          }),
        'schedule.toast.moved'
      );
      return;
    }
    const patch: SessionPatch = {};
    if (teacher !== String(item.teacher_id ?? '')) patch.teacher_id = teacher ? Number(teacher) : null;
    if (room !== String(item.room_id ?? '')) patch.room_id = room ? Number(room) : null;
    if (start !== (item.start ?? '') || end !== (item.end ?? '')) {
      patch.start_time = start || null;
      patch.end_time = end || null;
    }
    if (topic !== (item.topic ?? '')) patch.topic = topic;
    void run(() => sessionsApi.update(item.id, patch), 'schedule.toast.saved');
  };

  const timeFields = (
    <>
      <Field label={t('schedule.form.start')}>
        <input className="text-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label={t('schedule.form.end')}>
        <input className="text-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>
    </>
  );

  return (
    <Modal title={item.class_name} onClose={onClose} dirty={dirty}>
      {mode === 'view' ? (
        <>
          <dl className="dl sched-dl">
            <dt>{t('schedule.form.date')}</dt>
            <dd>{formatDate(item.date)}</dd>
            <dt>{t('schedule.form.time')}</dt>
            <dd>{item.start ? `${item.start}–${item.end}` : t('schedule.noTime')}</dd>
            <dt>{t('schedule.form.teacher')}</dt>
            <dd>
              {item.teacher_name ?? '-'}{' '}
              {item.substitute && <span className="badge badge-warning">{t('schedule.substitute')}</span>}
            </dd>
            <dt>{t('schedule.form.room')}</dt>
            <dd>{item.room_name ?? '-'}</dd>
            <dt>{t('schedule.form.topic')}</dt>
            <dd>{item.topic || '-'}</dd>
            <dt>{t('schedule.form.attendance')}</dt>
            <dd>{t('schedule.checkedIn', { count: item.attendance_count })}</dd>
          </dl>
          <div className="modal-actions sched-actions">
            {canManage && (
              <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmCancel(true)}>
                {t('schedule.cancelSession')}
              </button>
            )}
            <span className="spacer" />
            {canManage && item.attendance_count === 0 && (
              <button type="button" className="btn" onClick={() => setMode('move')}>
                {t('schedule.move')}
              </button>
            )}
            {canManage && (
              <button type="button" className="btn" onClick={() => setMode('edit')}>
                {t('actions.edit', { ns: 'common' })}
              </button>
            )}
            {item.date <= today && (
              <Link
                className="btn btn-primary"
                to={`/app/attendance?class=${item.class_id}&session=${item.id}`}
              >
                {t('schedule.takeAttendance')}
              </Link>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="form-grid">
            {mode === 'move' ? (
              <Field label={t('schedule.form.newDate')} span>
                <input
                  className="text-input"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label={t('schedule.form.teacher')} span hint={t('schedule.form.teacherHint')}>
                  <select className="text-input" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                    {!teachers.some((x) => String(x.id) === teacher) && teacher && (
                      <option value={teacher}>{item.teacher_name}</option>
                    )}
                    {teachers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('schedule.form.room')} span>
                  <select className="text-input" value={room} onChange={(e) => setRoom(e.target.value)}>
                    <option value="">{t('schedule.form.classRoom')}</option>
                    {rooms.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {timeFields}
            {mode === 'edit' && (
              <Field label={t('schedule.form.topic')} span>
                <input
                  className="text-input"
                  maxLength={255}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setMode('view')}>
              {t('actions.back', { ns: 'common' })}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {mode === 'move' ? t('schedule.move') : t('actions.save', { ns: 'common' })}
            </button>
          </div>
        </form>
      )}
      {confirmCancel && (
        <ConfirmDialog
          title={t('schedule.cancelTitle')}
          message={t('schedule.cancelMessage', { date: formatDate(item.date) })}
          danger
          confirmLabel={t('schedule.cancelSession')}
          onClose={() => setConfirmCancel(false)}
          onConfirm={() => run(() => sessionsApi.cancel(item.id), 'schedule.toast.cancelled')}
        />
      )}
    </Modal>
  );
}
