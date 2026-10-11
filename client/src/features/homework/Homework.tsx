import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { homeworkApi, type HomeworkStats, type HomeworkFilters } from './homework.api';
import { getUser } from '../../shared/api/client';
import { ClassItem } from '../classes/classes.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { Tabs, tabPanelProps } from '../../shared/components/Tabs';
import { HomeworkItem, formatDate, todayVN } from '../../shared/types';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlSearch, useUrlState } from '../../shared/hooks/useUrlState';
import './Homework.css';
import { HomeworkFormModal } from './HomeworkFormModal';
import { GradeModal } from './GradeModal';
import { QuizAttemptsModal } from './QuizAttemptsModal';
import { QuestionBank } from './QuestionBank';
import { SubmissionsModal } from './SubmissionsModal';
import { AnalyticsModal } from './AnalyticsModal';

function dueStatus(due: string | null, t: TFunction): { label: string; badge: string } | null {
  if (!due) return null;
  const today = todayVN(); // so sánh theo giờ VN, không dùng UTC
  const diff = Math.ceil((new Date(due).getTime() - new Date(today).getTime()) / 86400000);
  if (diff < 0) return { label: t('due.overdueDays', { count: -diff }), badge: 'badge-overdue' };
  if (diff === 0) return { label: t('due.today'), badge: 'badge-overdue' };
  if (diff <= 3) return { label: t('due.daysLeft', { count: diff }), badge: 'badge-late' };
  return { label: formatDate(due), badge: 'badge-upcoming' };
}

type StatusTab = '' | 'published' | 'draft' | 'scheduled';

export function Homework() {
  const { t } = useTranslation(['homework', 'common']);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [stats, setStats] = useState<HomeworkStats | null>(null);
  // UX-6: tab/bộ lọc/trang nằm trên URL -> reload hay Back vẫn giữ đúng chỗ
  const [q, setQ] = useUrlState({ search: '', class_id: '', kind: '', due: '', status: '', page: '1' });
  // B-2: chữ đang gõ ở state cục bộ, URL nhận giá trị đã debounce (fetch theo q.search)
  const [search, setSearch] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }), 400);
  const debouncedSearch = q.search;
  const statusTab = q.status as StatusTab;
  const page = Number(q.page) || 1;
  const [editing, setEditing] = useState<HomeworkItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<HomeworkItem | null>(null);
  const [unpublishing, setUnpublishing] = useState<HomeworkItem | null>(null);
  const [grading, setGrading] = useState<HomeworkItem | null>(null);
  const [attempts, setAttempts] = useState<HomeworkItem | null>(null);
  const [showBank, setShowBank] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [viewSubs, setViewSubs] = useState<HomeworkItem | null>(null);
  const toast = useToast();
  // Chống bấm đúp nút hành động trên từng dòng (pattern busyId của Tuition)
  const [busyId, setBusyId] = useState<number | null>(null);
  // Portal giáo viên (/teacher/bai-tap): ẩn tab/nút quản trị, chỉ giữ luồng giao bài nhanh
  const isTeacher = getUser()?.role === 'teacher';

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    draft: { label: t('status.draft'), cls: 'badge-general' },
    scheduled: { label: t('status.scheduled'), cls: 'badge-late' },
    published: { label: t('status.published'), cls: 'badge-paid' },
  };

  useEffect(() => {
    homeworkApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: unknown) => toastApiError(toast, err, t('states.loadError', { ns: 'common' })));
    homeworkApi
      .stats()
      .then(setStats)
      .catch(() => {});
  }, [toast]);

  // useLoad bỏ qua response cũ về muộn (đổi filter/tab/trang liên tục)
  const filters: HomeworkFilters = {
    class_id: q.class_id || undefined,
    kind: (q.kind || undefined) as HomeworkFilters['kind'],
    due: (q.due || undefined) as HomeworkFilters['due'],
    search: debouncedSearch.trim() || undefined,
  };
  const {
    data,
    loading,
    error,
    reload: load,
  } = useLoad(
    () => homeworkApi.list({ ...filters, status: statusTab || undefined }, { page }),
    [q.class_id, q.kind, q.due, debouncedSearch, statusTab, page]
  );
  const items = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  useEffect(() => {
    if (error) toastApiError(toast, error, t('toast.loadFail'));
  }, [error, toast, t]);

  const refreshStats = useCallback(() => {
    homeworkApi
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const onSaved = () => {
    setEditing(null);
    load();
    refreshStats();
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await homeworkApi.remove(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      load();
      refreshStats();
    } catch (err) {
      toastApiError(toast, err, t('toast.deleteFail'));
    }
  };

  const doReuse = async (h: HomeworkItem) => {
    if (busyId !== null) return;
    setBusyId(h.id);
    try {
      const res = await homeworkApi.reuse(h.id);
      toast(t('toast.reused'), 'success');
      setEditing(res.created);
      load();
    } catch (err) {
      toastApiError(toast, err, t('toast.reuseFail'));
    } finally {
      setBusyId(null);
    }
  };

  const doPublish = async (h: HomeworkItem) => {
    if (busyId !== null) return;
    setBusyId(h.id);
    try {
      await homeworkApi.publish(h.id);
      toast(t('toast.published'), 'success');
      load();
      refreshStats();
    } catch (err) {
      toastApiError(toast, err, t('toast.publishFail'));
    } finally {
      setBusyId(null);
    }
  };

  const doUnpublish = (h: HomeworkItem) => {
    setUnpublishing(h);
  };

  const confirmUnpublish = async () => {
    if (!unpublishing) return;
    const h = unpublishing;
    setUnpublishing(null);
    try {
      await homeworkApi.unpublish(h.id);
      toast(t('toast.unpublished'), 'success');
      load();
      refreshStats();
    } catch (err) {
      toastApiError(toast, err, t('toast.unpublishFail'));
    }
  };

  const setFilter = (patch: Partial<Record<'class_id' | 'kind' | 'due', string>>) =>
    setQ({ ...patch, page: '1' });

  // Giáo viên không thấy tab quản trị Bản nháp / Đã lên lịch
  const tabs: { id: StatusTab; label: string }[] = [
    { id: '', label: t('tabs.all') },
    { id: 'published', label: t('tabs.published') },
  ];
  if (!isTeacher) {
    tabs.push({ id: 'scheduled', label: t('tabs.scheduled') }, { id: 'draft', label: t('tabs.draft') });
  }

  return (
    <div className="page">
      <PageHeader
        title={t('page.title')}
        desc={t('page.desc')}
        actions={
          <>
            {!isTeacher && (
              <>
                <button className="btn hw-action-icon" onClick={() => setShowAnalytics(true)}>
                  <Icon name="chart" size={15} /> {t('actions.analytics')}
                </button>
                <button className="btn hw-action-icon" onClick={() => setShowBank(true)}>
                  <Icon name="book" size={15} /> {t('actions.questionBank')}
                </button>
              </>
            )}
            <button className="btn btn-primary hw-action-icon" onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} /> {t('actions.create')}
            </button>
          </>
        }
      />

      {stats && (
        <div className="stat-grid hw-stat-grid">
          <div className="stat-card tone-blue">
            <div className="stat-top">
              <div className="stat-icon">
                <Icon name="clipboard" size={20} />
              </div>
            </div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">{t('stats.published')}</div>
          </div>
          <div className="stat-card tone-amber">
            <div className="stat-top">
              <div className="stat-icon">
                <Icon name="clock" size={20} />
              </div>
            </div>
            <div className="stat-value">{stats.dueSoon}</div>
            <div className="stat-label">{t('stats.dueSoon')}</div>
          </div>
          <div className="stat-card tone-red">
            <div className="stat-top">
              <div className="stat-icon">
                <Icon name="calendar-x" size={20} />
              </div>
            </div>
            <div className="stat-value">{stats.overdue}</div>
            <div className="stat-label">{t('stats.overdue')}</div>
          </div>
          {!isTeacher && (
            <div className="stat-card tone-violet">
              <div className="stat-top">
                <div className="stat-icon">
                  <Icon name="file" size={20} />
                </div>
              </div>
              <div className="stat-value">{stats.drafts}</div>
              <div className="stat-label">{t('stats.drafts')}</div>
            </div>
          )}
        </div>
      )}

      <Tabs
        id="hw"
        label={t('tabs.label')}
        className="hw-tabs"
        tabs={tabs.map((tb) => ({ key: tb.id, label: tb.label }))}
        value={statusTab}
        onChange={(status) => setQ({ status, page: '1' })}
      />

      <div {...tabPanelProps('hw', statusTab)}>
        <div className="toolbar hw-toolbar">
          <span className={`search-wrap${search ? ' has-clear' : ''}`}>
            <span className="search-icon">
              <Icon name="search" size={15} />
            </span>
            <input
              className="text-input search-input"
              aria-label={t('filters.searchPlaceholder')}
              placeholder={t('filters.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search !== '' &&
              (loading || search !== debouncedSearch ? (
                <span className="search-clear" aria-hidden="true">
                  <span className="spinner spinner-dark" />
                </span>
              ) : (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setSearch('')}
                  aria-label={t('filters.clearSearch')}
                >
                  <Icon name="x" size={14} />
                </button>
              ))}
          </span>
          <select
            aria-label={t('filters.classFilterLabel')}
            className="text-input"
            value={q.class_id}
            onChange={(e) => setFilter({ class_id: e.target.value })}
          >
            <option value="">{t('filters.allClasses')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t('filters.kindFilterLabel')}
            className="text-input"
            value={q.kind}
            onChange={(e) => setFilter({ kind: e.target.value })}
          >
            <option value="">{t('filters.allKinds')}</option>
            <option value="homework">{t('filters.kindHomework')}</option>
            <option value="quiz">{t('filters.kindQuiz')}</option>
          </select>
          <select
            aria-label={t('filters.dueFilterLabel')}
            className="text-input"
            value={q.due}
            onChange={(e) => setFilter({ due: e.target.value })}
          >
            <option value="">{t('filters.allDues')}</option>
            <option value="upcoming">{t('filters.upcoming')}</option>
            <option value="overdue">{t('filters.overdue')}</option>
            <option value="nodate">{t('filters.noDate')}</option>
          </select>
        </div>

        <div className="card" aria-busy={loading || undefined}>
          {loading && !data ? (
            <TableSkeleton rows={6} cols={6} />
          ) : error && !data ? (
            <LoadError onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="file"
              title={t('empty.title')}
              desc={t('empty.desc')}
              action={
                <button className="btn btn-primary hw-action-icon" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={15} /> {t('actions.create')}
                </button>
              }
            />
          ) : (
            <div className="table-wrap sticky">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th scope="col">{t('table.title')}</th>
                    <th scope="col">{t('table.class')}</th>
                    <th scope="col">{t('table.status')}</th>
                    <th scope="col">{t('table.due')}</th>
                    <th scope="col" className="th-right">
                      {t('table.progress')}
                    </th>
                    <th scope="col" className="th-right">
                      {t('table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((h) => {
                    const due = dueStatus(h.due_date, t);
                    const st = STATUS_BADGE[h.status] || STATUS_BADGE.published;
                    const done = h.completed_count ?? 0;
                    const totalStudents = h.student_count ?? 0;
                    const pct = totalStudents > 0 ? Math.round((done / totalStudents) * 100) : 0;
                    return (
                      <tr key={h.id}>
                        <td>
                          <div className="hw-item-title">
                            {h.kind === 'quiz' && (
                              <span className="badge badge-plan-premium hw-quiz-badge">
                                {t('filters.kindQuiz')}
                              </span>
                            )}
                            {h.title}
                          </div>
                          {h.max_score != null && (
                            <div className="muted hw-sub">{t('table.maxScore', { max: h.max_score })}</div>
                          )}
                        </td>
                        <td data-label={t('table.class')}>
                          <span className="badge badge-general">{h.class_name}</span>
                        </td>
                        <td data-label={t('table.status')}>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                          {h.status === 'scheduled' && h.publish_at && (
                            <div className="muted hw-sub-sm">{formatDate(h.publish_at)}</div>
                          )}
                        </td>
                        <td data-label={t('table.due')}>
                          {due ? (
                            <span className={`badge ${due.badge}`}>{due.label}</span>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td data-label={t('table.progress')} className="td-right">
                          <div className="hw-progress">
                            <div className="hw-progress-track" aria-hidden="true">
                              <div className="hw-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="num">
                              {done}/{totalStudents}
                            </span>
                          </div>
                        </td>
                        <td className="td-right nowrap">
                          {h.status !== 'published' ? (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => doPublish(h)}
                              disabled={busyId === h.id}
                              title={t('actions.publishNow')}
                            >
                              {busyId === h.id && <span className="spinner" aria-hidden="true" />}
                              {t('actions.publish')}
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm"
                              onClick={() => doUnpublish(h)}
                              disabled={busyId === h.id}
                              title={t('actions.unpublishTitle')}
                            >
                              {t('actions.unpublish')}
                            </button>
                          )}{' '}
                          <button
                            className="btn btn-sm"
                            onClick={() => doReuse(h)}
                            disabled={busyId === h.id}
                            title={t('actions.reuseTitle')}
                          >
                            {busyId === h.id && <span className="spinner" aria-hidden="true" />}
                            {t('actions.reuse')}
                          </button>{' '}
                          {h.kind === 'quiz' ? (
                            <button className="btn btn-sm" onClick={() => setAttempts(h)}>
                              {t('actions.viewResults')}
                            </button>
                          ) : (
                            <button className="btn btn-sm" onClick={() => setGrading(h)}>
                              {t('actions.grade')}
                            </button>
                          )}{' '}
                          {h.kind === 'homework' && (
                            <>
                              <button className="btn btn-sm" onClick={() => setViewSubs(h)}>
                                {t('actions.viewSubmissions')}
                              </button>{' '}
                            </>
                          )}
                          <span className="row-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => setEditing(h)}
                            >
                              <Icon name="pencil" size={15} />
                              {t('actions.edit', { ns: 'common' })}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger-ghost"
                              onClick={() => setDeleting(h)}
                            >
                              <Icon name="trash" size={15} />
                              {t('actions.delete', { ns: 'common' })}
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pagination && (
          <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
        )}
      </div>

      {editing && (
        <HomeworkFormModal
          classes={classes}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
      {grading && (
        <GradeModal
          homework={grading}
          onClose={() => {
            setGrading(null);
            load();
          }}
        />
      )}
      {attempts && <QuizAttemptsModal homework={attempts} onClose={() => setAttempts(null)} />}
      {showBank && <QuestionBank onClose={() => setShowBank(false)} />}
      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} />}
      {viewSubs && (
        <SubmissionsModal
          homeworkId={viewSubs.id}
          title={viewSubs.title}
          closeDate={viewSubs.close_date}
          onClose={() => setViewSubs(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.message', { title: deleting.title })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
      {unpublishing && (
        <ConfirmDialog
          title={t('toast.unpublishTitle')}
          message={t('toast.unpublishConfirm', { title: unpublishing.title })}
          onClose={() => setUnpublishing(null)}
          onConfirm={confirmUnpublish}
        />
      )}
    </div>
  );
}
