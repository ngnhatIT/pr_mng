import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getUser } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { ParentChild } from '../../shared/types';
import './parent.css';

export function ParentHome() {
  const { t } = useTranslation(['parent', 'common']);
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
      toast(err instanceof Error ? err.message : t('home.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const linkChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast(t('home.codeRequired'), 'error');
      return;
    }
    setLinking(true);
    try {
      const r = await parentApi.linkChild(code.trim());
      toast(t('home.linkedSuccess', { name: r.student.name }), 'success');
      setCode('');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.linkError'), 'error');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="parent-page">
      <h1 className="parent-title">{t('home.greeting', { name: user?.name })}</h1>
      <p className="muted">{t('home.subtitle')}</p>

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
        <EmptyState icon="users" title={t('home.emptyTitle')} desc={t('home.emptyDesc')} />
      ) : (
        <div className="child-list">
          {children.map((c) => (
            <Link key={c.id} className="child-card" to={`/parent/children/${c.id}`}>
              <div className="child-card-head">
                <div className="child-avatar">{c.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="child-name">{c.name}</div>
                  <div className="muted mono child-code">{t('home.codeLabel', { code: c.code })}</div>
                </div>
                <span className="child-arrow" aria-hidden="true">
                  <Icon name="chevron-right" size={20} />
                </span>
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
                <p className="muted">{t('home.noClasses')}</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <section className="card parent-link-card">
        <h3 className="card-title">{t('home.linkTitle')}</h3>
        <p className="card-desc">{t('home.linkDesc')}</p>
        <form onSubmit={linkChild}>
          <Field label={t('home.codeField')}>
            <input
              className="text-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('home.codePlaceholder')}
            />
          </Field>
          <button className="btn btn-primary btn-block" type="submit" disabled={linking}>
            {linking ? t('home.linking') : t('home.linkAction')}
          </button>
        </form>
      </section>
    </div>
  );
}
