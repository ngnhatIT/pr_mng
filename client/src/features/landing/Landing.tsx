import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { http } from '../../shared/api/client';
import { PublicCenter, PublicClassItem, PublicTeacher, PublicReview, formatVND } from '../../shared/types';
import './Landing.css';

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

export function Landing() {
  const { t } = useTranslation(['landing', 'common']);
  const [searchParams] = useSearchParams();
  const [center, setCenter] = useState<PublicCenter | null>(null);
  const [courses, setCourses] = useState<PublicClassItem[]>([]);
  const [teachers, setTeachers] = useState<PublicTeacher[]>([]);
  const [reviews, setReviews] = useState<{ avg: number; total: number; items: PublicReview[] } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, cls, te, r] = await Promise.all([
          getJSON<PublicCenter>('/public/center'),
          getJSON<PublicClassItem[]>('/public/classes'),
          getJSON<PublicTeacher[]>('/public/teachers'),
          getJSON<{ avg: number; total: number; items: PublicReview[] }>('/public/reviews'),
        ]);
        setCenter(c);
        setCourses(cls);
        setTeachers(te);
        setReviews(r);
      } catch {
        /* trang public vẫn hiển thị phần tĩnh */
      }
    })();
  }, []);

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth' });

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
              <button className="btn btn-primary btn-lg" onClick={scrollToForm}>
                {t('hero.ctaConsult')}
              </button>
              <button className="btn btn-lg" onClick={scrollToForm}>
                {t('hero.ctaTrial')}
              </button>
            </div>
          </div>
          <div className="landing-hero-media">
            <img
              src="/landing-hero.jpg"
              alt={t('hero.imgAlt')}
              loading="eager"
              width="1920"
              height="1280"
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      <section className="landing-section" id="khoa-hoc">
        <div className="landing-section-head">
          <h2>{t('courses.title')}</h2>
          <p>{t('courses.sub')}</p>
        </div>
        {courses.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('courses.empty')}
          </p>
        ) : (
          <div className="course-grid">
            {courses.map((c) => (
              <div key={c.id} className="card course-card">
                <h3>{c.name}</h3>
                <dl className="dl dl-compact">
                  <dt>{t('courses.teacher')}</dt>
                  <dd>{c.teacher_name || '-'}</dd>
                  <dt>{t('courses.schedule')}</dt>
                  <dd>{c.schedule_text || '-'}</dd>
                  <dt>{t('courses.tuition')}</dt>
                  <dd>
                    <strong className="text-primary">{formatVND(c.tuition_fee)}</strong>
                  </dd>
                  <dt>{t('courses.capacity')}</dt>
                  <dd>{t('courses.students', { count: c.student_count })}</dd>
                </dl>
                <button className="btn btn-primary btn-block" onClick={scrollToForm}>
                  {t('courses.trial')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="landing-section landing-alt" id="giao-vien">
        <div className="landing-section-head">
          <h2>{t('teachers.title')}</h2>
          <p>{t('teachers.sub')}</p>
        </div>
        {teachers.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('teachers.empty')}
          </p>
        ) : (
          <div className="teacher-list">
            {teachers.map((te, i) => (
              <div key={i} className="teacher-row">
                <div className="teacher-avatar">{te.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="teacher-name">{te.name}</div>
                  <div className="muted">{te.subject || t('teachers.fallback')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
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
              <p className="review-comment">{r.comment || '-'}</p>
              <div className="testimonial-foot">
                <div className="testimonial-avatar">{(r.parent_name || 'P').charAt(0).toUpperCase()}</div>
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

      <section className="landing-section landing-alt" ref={formRef}>
        <h2>{t('formTitle')}</h2>
        <div className="two-col landing-forms">
          <LeadForm />
          <TrialForm refCode={searchParams.get('ref') || ''} courses={courses} />
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

function TrialForm({ refCode, courses }: { refCode: string; courses: PublicClassItem[] }) {
  const { t } = useTranslation(['landing', 'common']);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classId, setClassId] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [note, setNote] = useState('');
  const [referralCode, setReferralCode] = useState(refCode);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
