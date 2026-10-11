import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { peopleApi } from './people.api';
import { classesApi, type ClassItem } from '../classes/classes.api';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton, TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyCell } from '../../shared/components/EmptyCell';
import { Icon } from '../../shared/components/icons';
import { formatDate, type Teacher } from '../../shared/types';
import { fetchAllPages } from '../../shared/components/Pagination';
import { useGoBack } from '../../shared/hooks/useGoBack';
import './Teachers.css';

export function TeacherDetail() {
  const { t } = useTranslation(['people', 'classes', 'common']);
  const { id } = useParams<{ id: string }>();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'notFound' | 'load' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tid = Number(id);
      const [tch, cls] = await Promise.all([
        peopleApi.getTeacherDetail(tid),
        fetchAllPages((p) => classesApi.list('', p, tid)),
      ]);
      setTeacher(tch);
      setClasses(cls);
    } catch (err) {
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      setError(code === 'NOT_FOUND' ? 'notFound' : 'load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = useGoBack('/app/teachers');

  if (loading) {
    return (
      <div className="page">
        <Skeleton width={120} height={20} aria-hidden />
        <div style={{ marginTop: 8 }} aria-hidden>
          <Skeleton width={220} height={28} radius={8} />
        </div>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <Skeleton height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="80%" height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="60%" height={14} />
          </div>
        </section>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <TableSkeleton cols={3} rows={3} />
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <EmptyState
          icon="alert"
          title={t(`teacherDetail.${error === 'notFound' ? 'notFoundTitle' : 'loadErrorTitle'}`)}
          desc={t(`teacherDetail.${error === 'notFound' ? 'notFoundDesc' : 'loadErrorDesc'}`)}
          action={
            error === 'notFound' ? (
              <Link className="btn btn-primary btn-inline" to="/app/teachers">
                {t('teacherDetail.backToTeachers')}
              </Link>
            ) : (
              <button type="button" className="btn btn-primary btn-inline" onClick={() => void load()}>
                <Icon name="rotate" size={14} />
                {t('teacherDetail.retry')}
              </button>
            )
          }
        />
      </div>
    );
  }

  const tch = teacher as Teacher;

  return (
    <div className="page">
      <button type="button" className="link back-link" onClick={goBack}>
        <Icon name="arrow-left" size={14} />
        {t('teacherDetail.back')}
      </button>
      <nav className="detail-breadcrumb" aria-label={t('teacherDetail.breadcrumbLabel')}>
        <Link className="link" to="/app/teachers">
          {t('teacherDetail.breadcrumbStaff')}
        </Link>
        <span className="detail-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <Link className="link" to="/app/teachers">
          {t('teacherDetail.breadcrumbTeachers')}
        </Link>
        <span className="detail-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{tch.name}</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-title">{tch.name}</h1>
          {tch.subject && <p className="muted">{tch.subject}</p>}
        </div>
      </div>

      <section className="card">
        <div className="section-head">
          <h3>{t('teacherDetail.info')}</h3>
        </div>
        <dl className="kv">
          <dt>{t('teacherDetail.phone')}</dt>
          <dd>
            {tch.phone ? (
              <a className="link" href={`tel:${tch.phone.replace(/[\s.-]/g, '')}`}>
                {tch.phone}
              </a>
            ) : (
              <EmptyCell />
            )}
          </dd>
          <dt>{t('teacherDetail.email')}</dt>
          <dd>
            {tch.email ? (
              <a className="link" href={`mailto:${tch.email}`}>
                {tch.email}
              </a>
            ) : (
              <EmptyCell />
            )}
          </dd>
          <dt>{t('teacherDetail.subject')}</dt>
          <dd>{tch.subject || <EmptyCell />}</dd>
          <dt>{t('teacherDetail.classCount')}</dt>
          <dd className="num">{tch.class_count ?? 0}</dd>
          <dt>{t('teacherDetail.createdAt')}</dt>
          <dd>{formatDate(tch.created_at)}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="section-head">
          <h3>{t('teacherDetail.teachingClasses')}</h3>
        </div>
        {classes.length === 0 ? (
          <EmptyState
            icon="book"
            title={t('teacherDetail.noClassesTitle')}
            desc={t('teacherDetail.noClassesDesc')}
            action={
              <Link className="btn btn-primary btn-inline" to="/app/classes">
                {t('teacherDetail.viewClasses')}
              </Link>
            }
          />
        ) : (
          <div className="table-wrap sticky">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('teacherDetail.tableName')}</th>
                  <th scope="col" className="th-right">
                    {t('teacherDetail.tableStudents')}
                  </th>
                  <th scope="col">{t('teacherDetail.tableStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="link" to={`/app/classes/${c.id}`}>
                        {c.name}
                      </Link>
                    </td>
                    <td className="num">{c.student_count}</td>
                    <td>
                      <span className={`badge badge-${c.status}`}>
                        {t(`classStatus.${c.status}`, { ns: 'classes' })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
