import { useCallback, useEffect, useState } from 'react';
import {
  homeworkApi,
  type HomeworkStats,
  type HomeworkFilters,
} from './homework.api';
import { ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { HomeworkItem, formatDate } from '../../shared/types';
import { HomeworkFormModal } from './HomeworkFormModal';
import { GradeModal } from './GradeModal';
import { QuizAttemptsModal } from './QuizAttemptsModal';
import { QuestionBank } from './QuestionBank';
import { SubmissionsModal } from './SubmissionsModal';
import { AnalyticsModal } from './AnalyticsModal';

function dueStatus(due: string | null): { label: string; badge: string } | null {
  if (!due) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.ceil((new Date(due).getTime() - new Date(today).getTime()) / 86400000);
  if (diff < 0) return { label: `Quá hạn ${-diff} ngày`, badge: 'badge-overdue' };
  if (diff === 0) return { label: 'Hết hạn hôm nay', badge: 'badge-overdue' };
  if (diff <= 3) return { label: `Còn ${diff} ngày`, badge: 'badge-late' };
  return { label: formatDate(due), badge: 'badge-upcoming' };
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Nháp', cls: 'badge-general' },
  scheduled: { label: 'Hẹn giờ', cls: 'badge-late' },
  published: { label: 'Đã đăng', cls: 'badge-paid' },
};

type StatusTab = '' | 'published' | 'draft' | 'scheduled';

export function Homework() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [stats, setStats] = useState<HomeworkStats | null>(null);
  const [filters, setFilters] = useState<HomeworkFilters>({});
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<HomeworkItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<HomeworkItem | null>(null);
  const [grading, setGrading] = useState<HomeworkItem | null>(null);
  const [attempts, setAttempts] = useState<HomeworkItem | null>(null);
  const [showBank, setShowBank] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [viewSubs, setViewSubs] = useState<HomeworkItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  useEffect(() => {
    homeworkApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
    homeworkApi.stats().then(setStats).catch(() => {});
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await homeworkApi.list({ ...filters, status: statusTab || undefined }, { page });
      setItems(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được bài tập', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, statusTab, page, toast]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: search.trim() || undefined }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  const refreshStats = useCallback(() => {
    homeworkApi.stats().then(setStats).catch(() => {});
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
      toast('Đã xóa bài tập', 'success');
      setDeleting(null);
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  const doReuse = async (h: HomeworkItem) => {
    try {
      const res = await homeworkApi.reuse(h.id);
      toast('Đã tạo bản nháp từ bài tập cũ — chỉnh sửa rồi đăng', 'success');
      setEditing(res.created);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tái sử dụng thất bại', 'error');
    }
  };

  const doPublish = async (h: HomeworkItem) => {
    try {
      await homeworkApi.publish(h.id);
      toast('Đã đăng bài tập', 'success');
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Đăng thất bại', 'error');
    }
  };

  const doUnpublish = async (h: HomeworkItem) => {
    if (!confirm(`Gỡ đăng "${h.title}" về nháp? Phụ huynh sẽ không thấy bài này nữa.`)) return;
    try {
      await homeworkApi.unpublish(h.id);
      toast('Đã gỡ về nháp', 'success');
      void load();
      refreshStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gỡ đăng thất bại', 'error');
    }
  };

  const setFilter = (patch: Partial<HomeworkFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const tabs: { id: StatusTab; label: string }[] = [
    { id: '', label: 'Tất cả' },
    { id: 'published', label: 'Đã đăng' },
    { id: 'scheduled', label: 'Hẹn giờ' },
    { id: 'draft', label: 'Nháp' },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Bài tập về nhà"
        desc="Giao bài tập & quiz cho nhiều lớp — học từ Google Classroom, Canvas, Teams"
        actions={
          <>
            <button className="btn" onClick={() => setShowAnalytics(true)}>
              📊 Phân tích
            </button>
            <button className="btn" onClick={() => setShowBank(true)}>
              🏦 Ngân hàng câu hỏi
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Tạo bài tập
            </button>
          </>
        }
      />

      {stats && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card tone-blue">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Đã đăng</div>
          </div>
          <div className="stat-card tone-amber">
            <div className="stat-value">{stats.dueSoon}</div>
            <div className="stat-label">Sắp hết hạn (≤3 ngày)</div>
          </div>
          <div className="stat-card" style={{ borderTopColor: '#dc2626' }}>
            <div className="stat-value">{stats.overdue}</div>
            <div className="stat-label">Đã quá hạn</div>
          </div>
          <div className="stat-card tone-gray">
            <div className="stat-value">{stats.drafts}</div>
            <div className="stat-label">Nháp / Hẹn giờ</div>
          </div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${statusTab === t.id ? 'tab-active' : ''}`}
            onClick={() => { setStatusTab(t.id); setPage(1); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="text-input search-input"
          placeholder="Tìm theo tiêu đề, nội dung..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="text-input"
          value={filters.class_id || ''}
          onChange={(e) => setFilter({ class_id: e.target.value || undefined })}
        >
          <option value="">Tất cả lớp</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className="text-input"
          value={filters.kind || ''}
          onChange={(e) => setFilter({ kind: (e.target.value || undefined) as HomeworkFilters['kind'] })}
        >
          <option value="">Mọi loại</option>
          <option value="homework">Bài tập</option>
          <option value="quiz">Quiz trắc nghiệm</option>
        </select>
        <select
          className="text-input"
          value={filters.due || ''}
          onChange={(e) => setFilter({ due: (e.target.value || undefined) as HomeworkFilters['due'] })}
        >
          <option value="">Mọi hạn nộp</option>
          <option value="upcoming">Sắp tới</option>
          <option value="overdue">Quá hạn</option>
          <option value="nodate">Chưa đặt hạn</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="file"
            title="Chưa có bài tập nào"
            desc="Tạo bài tập mới, lưu nháp hoặc hẹn giờ đăng."
            action={
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                + Tạo bài tập
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bài tập</th>
                  <th>Lớp</th>
                  <th>Trạng thái</th>
                  <th>Hạn nộp</th>
                  <th className="th-right">Hoàn thành</th>
                  <th className="th-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((h) => {
                  const due = dueStatus(h.due_date);
                  const st = STATUS_BADGE[h.status] || STATUS_BADGE.published;
                  return (
                    <tr key={h.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {h.kind === 'quiz' && <span className="badge badge-plan-premium" style={{ marginRight: 6 }}>Quiz</span>}
                          {h.title}
                        </div>
                        {h.max_score != null && (
                          <div className="muted" style={{ fontSize: 13 }}>Điểm tối đa: {h.max_score}</div>
                        )}
                      </td>
                      <td><span className="badge badge-general">{h.class_name}</span></td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {h.status === 'scheduled' && h.publish_at && (
                          <div className="muted" style={{ fontSize: 12 }}>{formatDate(h.publish_at)}</div>
                        )}
                      </td>
                      <td>{due ? <span className={`badge ${due.badge}`}>{due.label}</span> : <span className="muted">—</span>}</td>
                      <td className="td-right"><span className="num">{h.completed_count ?? 0}/{h.student_count ?? 0}</span></td>
                      <td className="td-right nowrap">
                        {h.status !== 'published' ? (
                          <button className="btn btn-sm btn-primary" onClick={() => doPublish(h)} title="Đăng ngay">Đăng</button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => doUnpublish(h)} title="Gỡ về nháp">Gỡ đăng</button>
                        )}{' '}
                        <button className="btn btn-sm" onClick={() => doReuse(h)} title="Tạo bản mới từ bài này">Tái sử dụng</button>{' '}
                        {h.kind === 'quiz' ? (
                          <button className="btn btn-sm" onClick={() => setAttempts(h)}>Kết quả</button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => setGrading(h)}>Chấm điểm</button>
                        )}{' '}
                        <button className="btn btn-sm" onClick={() => setEditing(h)}>Sửa</button>{' '}
                        {h.kind === 'homework' && (
                          <>
                            <button className="btn btn-sm" onClick={() => setViewSubs(h)}>Bài nộp</button>{' '}
                          </>
                        )}
                        <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(h)}>Xóa</button>
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
        <GradeModal homework={grading} onClose={() => { setGrading(null); void load(); }} />
      )}
      {attempts && (
        <QuizAttemptsModal homework={attempts} onClose={() => setAttempts(null)} />
      )}
      {showBank && <QuestionBank onClose={() => setShowBank(false)} />}
      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} />}
      {viewSubs && (
        <SubmissionsModal homeworkId={viewSubs.id} title={viewSubs.title} onClose={() => setViewSubs(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa bài tập"
          message={`Xóa bài tập "${deleting.title}"?`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}
