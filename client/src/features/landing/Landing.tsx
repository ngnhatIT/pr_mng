import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { Skeleton } from '../../shared/components/Skeleton';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { http } from '../../shared/api/client';
import { PublicCenter, PublicClassItem, PublicTeacher, PublicReview, formatVND } from '../../shared/types';
import './Landing.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

async function getJSON<T>(path: string): Promise<T> {
  try {
    return await http.get<T>(path);
  } catch {
    throw new Error('loadError');
  }
}

function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation(['landing', 'common']);
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={t('reviews.stars', { rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={16} filled className={i <= full ? 'star on' : 'star'} />
      ))}
    </span>
  );
}

/** Khung 3 trạng thái loading / error / empty dùng chung cho khối khóa học và giáo viên. */
function SectionState({
  status,
  isEmpty,
  emptyText,
  skeleton,
  onRetry,
  children,
}: {
  status: 'loading' | 'error' | 'ready';
  isEmpty: boolean;
  emptyText: string;
  skeleton: React.ReactNode;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation(['landing', 'common']);
  if (status === 'loading') return <>{skeleton}</>;
  if (status === 'error') {
    return (
      <div className="landing-load-error" role="alert">
        <Icon name="alert" size={20} aria-hidden="true" />
        <p>{t('loadError')}</p>
        <button className="btn btn-primary btn-sm" onClick={onRetry}>
          <Icon name="rotate" size={14} aria-hidden="true" />
          {t('actions.retry', { ns: 'common' })}
        </button>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <p className="muted" style={{ textAlign: 'center' }}>
        {emptyText}
      </p>
    );
  }
  return <>{children}</>;
}

export function Landing() {
  const { t } = useTranslation(['landing', 'common']);
  useDocumentTitle('');
  const [searchParams] = useSearchParams();
  const [center, setCenter] = useState<PublicCenter | null>(null);
  const [courses, setCourses] = useState<PublicClassItem[]>([]);
  const [teachers, setTeachers] = useState<PublicTeacher[]>([]);
  const [reviews, setReviews] = useState<{ avg: number; total: number; items: PublicReview[] } | null>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trialRef = useRef<HTMLDivElement>(null);
  // Khóa học user vừa bấm "Đăng ký học thử" trên thẻ khóa học -> preselect trong TrialForm
  const [trialClassId, setTrialClassId] = useState<number | null>(null);
  // Phân biệt loading / error / empty cho từng khối (trước đây catch nuốt lỗi,
  // khối khóa học/giáo viên treo "Đang tải..." vĩnh viễn khi API lỗi)
  const [coursesStatus, setCoursesStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [teachersStatus, setTeachersStatus] = useState<'loading' | 'error' | 'ready'>('loading');

  const loadPublic = useCallback(async () => {
    setCoursesStatus('loading');
    setTeachersStatus('loading');
    // Thông tin trung tâm + đánh giá: lỗi thì dùng fallback tĩnh, không chặn trang
    const [c, r] = await Promise.allSettled([
      getJSON<PublicCenter>('/public/center'),
      getJSON<{ avg: number; total: number; items: PublicReview[] }>('/public/reviews'),
    ]);
    if (c.status === 'fulfilled') setCenter(c.value);
    if (r.status === 'fulfilled') setReviews(r.value);
    // Khóa học + giáo viên: lỗi phải hiện thông báo + nút thử lại, không treo loading
    const [cls, te] = await Promise.allSettled([
      getJSON<PublicClassItem[]>('/public/classes'),
      getJSON<PublicTeacher[]>('/public/teachers'),
    ]);
    if (cls.status === 'fulfilled') {
      setCourses(cls.value);
      setCoursesStatus('ready');
    } else {
      setCoursesStatus('error');
    }
    if (te.status === 'fulfilled') {
      setTeachers(te.value);
      setTeachersStatus('ready');
    } else {
      setTeachersStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  // Mỗi CTA cuộn tới đúng form của nó (tư vấn vs học thử là 2 form khác nhau).
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    // Tôn trọng người dùng yêu cầu giảm chuyển động (WCAG 2.3.3)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const scrollToLead = () => scrollTo(leadRef);
  const scrollToTrial = () => scrollTo(trialRef);

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <div className="brand-logo">E</div>
          <span>{center?.name || 'EduCenter Pro'}</span>
        </div>
        <div className="landing-nav-links">
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#khoa-hoc">
            {t('nav.courses')}
          </a>
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#giao-vien">
            {t('nav.teachers')}
          </a>
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#danh-gia">
            {t('nav.reviews')}
          </a>
          <Link className="btn btn-sm" to="/parent/login">
            {t('nav.parent')}
          </Link>
          <Link className="btn btn-sm btn-primary" to="/login">
            {t('nav.login')}
          </Link>
          <ThemeLangSwitch />
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <div className="landing-badge">{t('hero.badge')}</div>
            <h1>{center?.name || t('hero.fallbackName')}</h1>
            <p className="landing-hero-sub">{t('hero.sub')}</p>
            <div className="landing-hero-cta">
              <button className="btn btn-primary btn-lg" onClick={scrollToLead}>
                {t('hero.ctaConsult')}
              </button>
              <button className="btn btn-lg" onClick={scrollToTrial}>
                {t('hero.ctaTrial')}
              </button>
            </div>
          </div>
          <div className="landing-hero-visual" aria-hidden="true">
            <span className="landing-hero-orb landing-hero-orb-a" />
            <span className="landing-hero-orb landing-hero-orb-b" />
            <span className="landing-hero-ring" />
          </div>
        </div>
      </section>

      <section className="landing-section" id="khoa-hoc">
        <div className="landing-section-head">
          <h2>{t('courses.title')}</h2>
          <p>{t('courses.sub')}</p>
        </div>
        <SectionState
          status={coursesStatus}
          isEmpty={courses.length === 0}
          emptyText={t('courses.empty')}
          onRetry={() => void loadPublic()}
          skeleton={
            <div className="course-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card">
                  <Skeleton height={150} radius={10} />
                </div>
              ))}
            </div>
          }
        >
          <div className="course-grid">
            {courses.map((c) => (
              <div key={c.id} className="card course-card">
                <h3>{c.name}</h3>
                <dl className="dl dl-compact">
                  <dt>{t('courses.teacher')}</dt>
                  <dd>{c.teacher_name || <EmptyCell />}</dd>
                  <dt>{t('courses.schedule')}</dt>
                  <dd>{c.schedule_text || <EmptyCell />}</dd>
                  <dt>{t('courses.tuition')}</dt>
                  <dd>
                    <strong className="text-primary">{formatVND(c.tuition_fee)}</strong>
                  </dd>
                  <dt>{t('courses.capacity')}</dt>
                  <dd>{t('courses.students', { count: c.student_count })}</dd>
                </dl>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => {
                    setTrialClassId(c.id);
                    scrollToTrial();
                  }}
                >
                  {t('courses.trial')}
                </button>
              </div>
            ))}
          </div>
        </SectionState>
      </section>

      <section className="landing-section landing-alt" id="giao-vien">
        <div className="landing-section-head">
          <h2>{t('teachers.title')}</h2>
          <p>{t('teachers.sub')}</p>
        </div>
        <SectionState
          status={teachersStatus}
          isEmpty={teachers.length === 0}
          emptyText={t('teachers.empty')}
          onRetry={() => void loadPublic()}
          skeleton={
            <div className="teacher-list" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="teacher-row">
                  <Skeleton width={48} height={48} radius={24} />
                  <div style={{ flex: 1 }}>
                    <Skeleton width="40%" height={16} radius={6} />
                    <div style={{ marginTop: 6 }}>
                      <Skeleton width="60%" height={13} radius={6} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <div className="teacher-list">
            {teachers.map((te, i) => (
              <div key={i} className="teacher-row">
                <div className="teacher-avatar" aria-hidden="true">
                  <Icon name="user" size={22} />
                </div>
                <div>
                  <div className="teacher-name">{te.name}</div>
                  <div className="muted">{te.subject || t('teachers.fallback')}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionState>
      </section>

      <section className="landing-section" id="danh-gia">
        <div className="landing-section-head">
          <h2>{t('reviews.title')}</h2>
          <p>{t('reviews.sub')}</p>
        </div>
        {reviews && reviews.items.length > 0 && (
          <p className="landing-avg">
            <Stars rating={reviews.avg} /> <strong>{reviews.avg.toFixed(1)}/5</strong>{' '}
            <span className="muted">{t('reviews.count', { total: reviews.total })}</span>
          </p>
        )}
        <div className="course-grid">
          {(reviews?.items || []).map((r, i) => (
            <div key={i} className="card review-card testimonial">
              <Stars rating={r.rating} />
              <p className="review-comment">{r.comment || <EmptyCell />}</p>
              <div className="testimonial-foot">
                <Icon name="user" size={15} aria-hidden="true" />
                <div className="muted">{r.parent_name || t('reviews.fallbackName')}</div>
              </div>
            </div>
          ))}
        </div>
        {(!reviews || reviews.items.length === 0) && (
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('reviews.empty')}
          </p>
        )}
      </section>

      <section className="landing-section landing-alt">
        <h2>{t('formTitle')}</h2>
        <div className="two-col landing-forms">
          <div ref={leadRef} id="dang-ky-tu-van" className="landing-form-anchor">
            <LeadForm />
          </div>
          <div ref={trialRef} id="dang-ky-hoc-thu" className="landing-form-anchor">
            <TrialForm
              refCode={searchParams.get('ref') || ''}
              courses={courses}
              preselectClassId={trialClassId}
            />
          </div>
        </div>
      </section>

      <footer className="landing-footer" id="lien-he">
        <div className="landing-footer-inner">
          <div>
            <div className="landing-brand" style={{ marginBottom: 8 }}>
              <div className="brand-logo">E</div>
              <strong>{center?.name || 'EduCenter Pro'}</strong>
            </div>
            <div className="muted">
              {center?.phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Icon name="phone" size={14} /> {center.phone}
                </div>
              )}
              {center?.address && <div>{center.address}</div>}
            </div>
          </div>
          <div className="landing-footer-links">
            <Link className="btn btn-sm" to="/login">
              {t('footerLogin')}
            </Link>
            <Link className="btn btn-sm btn-primary" to="/parent/login">
              {t('footerParent')}
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function LeadForm() {
  const { t } = useTranslation(['landing', 'common']);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await http.post('/public/leads', { name, phone, note: note || undefined });
      toast(t('lead.success'), 'success');
      setName('');
      setPhone('');
      setNote('');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('lead.fail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">{t('lead.title')}</h3>
      <p className="card-desc">{t('lead.desc')}</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('fields.name')} span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('fields.phone')} span>
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label={t('fields.note')} span>
            <textarea
              className="text-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('sending') : t('lead.submit')}
        </button>
      </form>
    </div>
  );
}

function TrialForm({
  refCode,
  courses,
  preselectClassId,
}: {
  refCode: string;
  courses: PublicClassItem[];
  preselectClassId: number | null;
}) {
  const { t } = useTranslation(['landing', 'common']);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classId, setClassId] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [note, setNote] = useState('');
  const [referralCode, setReferralCode] = useState(refCode);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Bấm "Đăng ký học thử" trên thẻ khóa học -> dropdown preselect sẵn lớp đó
  useEffect(() => {
    if (preselectClassId !== null) setClassId(String(preselectClassId));
  }, [preselectClassId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await http.post('/public/trials', {
        name,
        phone,
        class_id: classId ? Number(classId) : undefined,
        desired_date: desiredDate || undefined,
        note: note || undefined,
        referral_code: referralCode || undefined,
      });
      toast(t('trial.success'), 'success');
      setName('');
      setPhone('');
      setClassId('');
      setDesiredDate('');
      setNote('');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('trial.fail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">{t('trial.title')}</h3>
      <p className="card-desc">{t('trial.desc')}</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('fields.name')}>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('fields.phone')}>
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label={t('fields.class')}>
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{t('fields.noClass')}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('fields.date')}>
            <input
              className="text-input"
              type="date"
              value={desiredDate}
              onChange={(e) => setDesiredDate(e.target.value)}
            />
          </Field>
          <Field label={t('fields.referral')}>
            <input
              className="text-input"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder={t('fields.referralPh')}
            />
          </Field>
          <Field label={t('fields.note')}>
            <textarea
              className="text-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('sending') : t('trial.submit')}
        </button>
      </form>
    </div>
  );
}
