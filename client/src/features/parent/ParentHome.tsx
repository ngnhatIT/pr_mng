import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { ParentChild } from '../../shared/types';

export function ParentHome() {
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [linking, setLinking] = useState(false);
  const toast = useToast();
  const user = getUser();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await parentApi.children();
      setChildren(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách con', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const linkChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast('Vui lòng nhập mã học viên', 'error');
      return;
    }
    setLinking(true);
    try {
      const r = await parentApi.linkChild(code.trim());
      toast(`Đã liên kết với học viên ${r.student.name}`, 'success');
      setCode('');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Liên kết thất bại', 'error');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="parent-page">
      <h1 className="parent-title">Xin chào, {user?.name}!</h1>
      <p className="muted">Theo dõi tiến độ học tập của con bạn tại đây.</p>

      {loading ? (
        <div className="child-list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <Skeleton width="50%" height={20} radius={8} />
              <div style={{ marginTop: 10 }}>
                <Skeleton width="30%" height={13} />
              </div>
            </div>
          ))}
        </div>
      ) : children.length === 0 ? (
        <EmptyState
          icon="users"
          title="Chưa liên kết con nào"
          desc="Nhập mã học viên do trung tâm cấp ở biểu mẫu bên dưới để bắt đầu theo dõi."
        />
      ) : (
        <div className="child-list">
          {children.map((c) => (
            <Link key={c.id} className="child-card" to={`/parent/children/${c.id}`}>
              <div className="child-card-head">
                <div className="child-avatar">{c.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="child-name">{c.name}</div>
                  <div className="muted mono child-code">{c.code}</div>
                </div>
                <span className="child-arrow">›</span>
              </div>
              {c.classes.length > 0 ? (
                <div className="child-classes">
                  {c.classes.map((cl) => (
                    <span key={cl.id} className="badge badge-active">
                      {cl.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">Chưa ghi danh lớp nào</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <section className="card parent-link-card">
        <h3 className="card-title">Liên kết con</h3>
        <p className="card-desc">Nhập mã học viên do trung tâm cấp để xem thông tin học tập của con.</p>
        <form onSubmit={linkChild}>
          <Field label="Mã học viên">
            <input
              className="text-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="VD: HV001"
            />
          </Field>
          <button className="btn btn-primary btn-block" type="submit" disabled={linking}>
            {linking ? 'Đang liên kết...' : 'Liên kết'}
          </button>
        </form>
      </section>
    </div>
  );
}
