import { useCallback, useEffect, useState } from 'react';
import { referralsApi, ReferralStats } from './growth.api';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton, StatGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { ReferralItem, formatDate } from '../../shared/types';

export function ReferralsAdmin() {
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([referralsApi.list(status, { page }), referralsApi.stats()]);
      setReferrals(list.data);
      setPagination(list.pagination);
      setStats(st);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được dữ liệu giới thiệu', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader title="Giới thiệu" desc="Theo dõi lượt giới thiệu và thưởng credits" />

      {loading ? (
        <>
          <StatGridSkeleton count={3} />
          <div style={{ height: 16 }} />
          <TableSkeleton cols={4} />
        </>
      ) : (
        <>
          {stats && (
            <div className="stat-grid stat-grid-3">
              <div className="stat-card">
                <div className="stat-value">{stats.total}</div>
                <div className="stat-label">Tổng lượt giới thiệu</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.pending}</div>
                <div className="stat-label">Đang chờ thưởng</div>
              </div>
              <div className="stat-card stat-card-highlight">
                <div className="stat-value">{stats.rewarded}</div>
                <div className="stat-label">Đã thưởng</div>
              </div>
            </div>
          )}

          <div className="toolbar">
            <select
              className="text-input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Đang chờ</option>
              <option value="rewarded">Đã thưởng</option>
            </select>
          </div>

          {referrals.length === 0 ? (
            <EmptyState
              icon="gift"
              title="Không có lượt giới thiệu nào"
              desc="Chưa có phụ huynh nào giới thiệu bạn bè."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>SĐT được giới thiệu</th>
                    <th>Trạng thái</th>
                    <th>Thưởng</th>
                    <th>Ngày tạo</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.referred_phone}</td>
                      <td>
                        <span className={`badge badge-${r.status === 'rewarded' ? 'rewarded' : 'pending'}`}>
                          {r.status === 'rewarded' ? 'Đã thưởng' : 'Đang chờ'}
                        </span>
                      </td>
                      <td className="num">{r.reward_amount != null ? r.reward_amount : '—'}</td>
                      <td>{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}
        </>
      )}
    </div>
  );
}
