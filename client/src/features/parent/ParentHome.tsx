import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getUser } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Field, useFieldErrors } from '../../shared/components/Form';
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
  const [dob, setDob] = useState('');
  const [linking, setLinking] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'code' | 'dob'>();
  const linkCardRef = useRef<HTMLElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
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
    // Lỗi form hiện inline dưới field, đồng bộ với 2 màn đăng nhập (skill 8.2)
    const errs: { code?: string; dob?: string } = {};
    if (!code.trim()) errs.code = t('home.codeRequired');
    if (!dob) errs.dob = t('home.dobRequired');
    if (!show(errs)) return;
    setLinking(true);
    try {
      const r = await parentApi.linkChild(code.trim(), dob);
      toast(t('home.linkedSuccess', { name: r.student.name }), 'success');
      setCode('');
      setDob('');
      void load();
    } catch (err) {
      // Lỗi liên kết (sai mã/ngày sinh): hiện dưới ô mã, focus để nhập lại
      show({ code: err instanceof Error ? err.message : t('home.linkError') });
    } finally {
      setLinking(false);
    }
  };

  // Empty state "chưa có con": nút hành động cuộn tới form liên kết và focus ô mã
  const focusLinkForm = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    linkCardRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    codeInputRef.current?.focus({ preventScroll: true });
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
        <EmptyState
          icon="users"
          title={t('home.emptyTitle')}
          desc={t('home.emptyDesc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={focusLinkForm}>
              {t('home.linkAction')}
            </button>
          }
        />
      ) : (
        <div className="child-list">
          {children.map((c) => (
            <Link key={c.id} className="child-card" to={`/parent/children/${c.id}`}>
              <div className="child-card-head">
                <div className="child-avatar" aria-hidden="true">
                  <Icon name="user" size={20} />
                </div>
                <div className="child-head-main">
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

      <section className="card parent-link-card" ref={linkCardRef}>
        <h3 className="card-title">{t('home.linkTitle')}</h3>
        <p className="card-desc">{t('home.linkDesc')}</p>
        <form onSubmit={linkChild}>
          <Field label={t('home.codeField')} error={errors.code} required>
            <input
              className="text-input"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                clear('code');
              }}
              placeholder={t('home.codePlaceholder')}
              ref={(el) => {
                codeInputRef.current = el;
                refFor('code')(el);
              }}
            />
          </Field>
          <Field label={t('home.dobField')} error={errors.dob} required>
            <input
              className="text-input"
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
                clear('dob');
              }}
              ref={refFor('dob')}
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
