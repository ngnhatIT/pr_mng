import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { homeworkApi, type HomeworkStats, type HomeworkFilters } from './homework.api';
import { ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { HomeworkItem, formatDate } from '../../shared/types';
import './Homework.css';
import { HomeworkFormModal } from './HomeworkFormModal';
import { GradeModal } from './GradeModal';
import { QuizAttemptsModal } from './QuizAttemptsModal';
import { QuestionBank } from './QuestionBank';
import { SubmissionsModal } from './SubmissionsModal';
import { AnalyticsModal } from './AnalyticsModal';

function dueStatus(due: string | null, t: TFunction): { label: string; badge: string } | null {
  if (!due) return null;
  const today = new Date().toISOString().slice(0, 10);
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
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [stats, setStats] = useState<HomeworkStats | null>(null);
  const [filters, setFilters] = useState<HomeworkFilters>({});
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<HomeworkItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<HomeworkItem | null>(null);
  const [unpublishing, setUnpublishing] = useState<HomeworkItem | null>(null);
  const [grading, setGrading] = useState<HomeworkItem | null>(null);
  const [attempts, setAttempts] = useState<HomeworkItem | null>(null);
  const [showBank, setShowBank] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [viewSubs, setViewSubs] = useState<HomeworkItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    draft: { label: t('status.draft'), cls: 'badge-general' },
    scheduled: { label: t('status.scheduled'), cls: 'badge-late' },
    published: { label: t('status.published'), cls: 'badge-paid' },
  };

  useEffect(() => {
    homeworkApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
    homeworkApi
      .stats()
      .then(setStats)
      .catch(() => {});
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await homeworkApi.list({ ...filters, status: statusTab || undefined }, { page });
      setItems(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, statusTab, page, toast, t]);

  useEffect(() => {
    const tm = setTimeout(() => {
      setFilters((f) => ({ ...f, search: search.trim() || undefined }));
      setPage(1);
    }, 400);
    return () => clearTimeout(tm);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshStats = useCallback(() => {
    homeworkApi
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const onSaved = () => {
    setEditing(null);
    void load();
    refreshStats();
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await homeworkApi.remove(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.deleteFail'), 'error');
    }
  };

  const doReuse = async (h: HomeworkItem) => {
    try {
      const res = await homeworkApi.reuse(h.id);
      toast(t('toast.reused'), 'success');
      setEditing(res.created);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.reuseFail'), 'error');
    }
  };

  const doPublish = async (h: HomeworkItem) => {
    try {
      await homeworkApi.publish(h.id);
      toast(t('toast.published'), 'success');
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.publishFail'), 'error');
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
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.unpublishFail'), 'error');
    }
  };

  const setFilter = (patch: Partial<HomeworkFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const tabs: { id: StatusTab; label: string }[] = [
    { id: '', label: t('tabs.all') },
    { id: 'published', label: t('tabs.published') },
    { id: 'scheduled', label: t('tabs.scheduled') },
    { id: 'draft', label: t('tabs.draft') },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t('page.title')}
        desc={t('page.desc')}
        actions={
          <>
            <button className="btn hw-action-icon" onClick={() => setShowAnalytics(true)}>
              <Icon name="chart" size={15} /> {t('actions.analytics')}
            </button>
            <button className="btn hw-action-icon" onClick={() => setShowBank(true)}>
              <Icon name="book" size={15} /> {t('actions.questionBank')}
            </button>
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
          <div className="stat-card tone-violet">
            <div className="stat-top">
              <div className="stat-icon">
                <Icon name="file" size={20} />
              </div>
            </div>
            <div className="stat-value">{stats.drafts}</div>
            <div className="stat-label">{t('stats.drafts')}</div>
          </div>
        </div>
      )}

      <div className="tabs hw-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${statusTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              setStatusTab(tab.id);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="toolbar hw-toolbar">
        <input
          className="text-input search-input"
          aria-label={t('filters.searchPlaceholder')}
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Lọc theo trạng thái"
          className="text-input"
          value={filters.class_id || ''}
          onChange={(e) => setFilter({ class_id: e.target.value || undefined })}
        >
          <option value="">{t('filters.allClasses')}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc theo lớp"
          className="text-input"
          value={filters.kind || ''}
          onChange={(e) => setFilter({ kind: (e.target.value || undefined) as HomeworkFilters['kind'] })}
        >
          <option value="">{t('filters.allKinds')}</option>
          <option value="homework">{t('filters.kindHomework')}</option>
          <option value="quiz">{t('filters.kindQuiz')}</option>
        </select>
        <select
          aria-label="Lọc theo môn"
          className="text-input"
          value={filters.due || ''}
          onChange={(e) => setFilter({ due: (e.target.value || undefined) as HomeworkFilters['due'] })}
        >
          <option value="">{t('filters.allDues')}</option>
          <option value="upcoming">{t('filters.upcoming')}</option>
          <option value="overdue">{t('filters.overdue')}</option>
          <option value="nodate">{t('filters.noDate')}</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
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
          <div className="table-wrap">
            <table className="table">
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
                      <td>
                        <span className="badge badge-general">{h.class_name}</span>
                      </td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {h.status === 'scheduled' && h.publish_at && (
                          <div className="muted hw-sub-sm">{formatDate(h.publish_at)}</div>
                        )}
                      </td>
                      <td>
                        {due ? (
                          <span className={`badge ${due.badge}`}>{due.label}</span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td className="td-right">
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
                            title={t('actions.publishNow')}
                          >
                            {t('actions.publish')}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={() => doUnpublish(h)}
                            title={t('actions.unpublishTitle')}
                          >
                            {t('actions.unpublish')}
                          </button>
                        )}{' '}
                        <button
                          className="btn btn-sm"
                          onClick={() => doReuse(h)}
                          title={t('actions.reuseTitle')}
                        >
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
                        <button className="btn btn-sm" onClick={() => setEditing(h)}>
                          {t('actions.edit', { ns: 'common' })}
                        </button>{' '}
                        {h.kind === 'homework' && (
                          <>
                            <button className="btn btn-sm" onClick={() => setViewSubs(h)}>
                              {t('actions.viewSubmissions')}
                            </button>{' '}
                          </>
                        )}
                        <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(h)}>
                          {t('actions.delete', { ns: 'common' })}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

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
            void load();
          }}
        />
      )}
      {attempts && <QuizAttemptsModal homework={attempts} onClose={() => setAttempts(null)} />}
      {showBank && <QuestionBank onClose={() => setShowBank(false)} />}
      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} />}
      {viewSubs && (
        <SubmissionsModal homeworkId={viewSubs.id} title={viewSubs.title} onClose={() => setViewSubs(null)} />
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
