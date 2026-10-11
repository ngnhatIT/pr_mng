import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { Skeleton } from '../../shared/components/Skeleton';
import { Tabs, tabPanelProps } from '../../shared/components/Tabs';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { http } from '../../shared/api/client';
import {
  PublicCenter,
  PublicClassItem,
  PublicTeacher,
  PublicReview,
  formatVND,
  initials,
} from '../../shared/types';
import './Landing.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

type Status = 'loading' | 'error' | 'ready';
type FormMode = 'trial' | 'lead';
type Reviews = { avg: number; total: number; items: PublicReview[] };

async function getJSON<T>(path: string): Promise<T> {
  try {
    return await http.get<T>(path);
  } catch {
    throw new Error('loadError');
  }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation('landing');
  const full = Math.round(rating);
  return (
    <span className="lp-stars" role="img" aria-label={t('reviews.stars', { rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={14} filled className={i <= full ? 'on' : undefined} />
      ))}
    </span>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation(['landing', 'common']);
  return (
    <div className="lp-load-error" role="alert">
      <p>{t('loadError')}</p>
      <button className="lp-btn lp-btn-ghost" onClick={onRetry}>
        <Icon name="rotate" size={14} aria-hidden="true" />
        {t('actions.retry', { ns: 'common' })}
      </button>
    </div>
  );
}

export function Landing() {
  const { t } = useTranslation(['landing', 'common']);
  useDocumentTitle('');
  const [searchParams] = useSearchParams();
  const [center, setCenter] = useState<PublicCenter | null>(null);
  const [courses, setCourses] = useState<PublicClassItem[]>([]);
  const [teachers, setTeachers] = useState<PublicTeacher[]>([]);
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [coursesStatus, setCoursesStatus] = useState<Status>('loading');
  const [teachersStatus, setTeachersStatus] = useState<Status>('loading');
  const [formMode, setFormMode] = useState<FormMode>('trial');
  // Khóa học vừa bấm "Học thử lớp này" -> chọn sẵn trong form học thử
  const [trialClassId, setTrialClassId] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const loadPublic = useCallback(async () => {
    setCoursesStatus('loading');
    setTeachersStatus('loading');
    // Thông tin trung tâm + đánh giá: lỗi thì ẩn khối liên quan, không chặn trang
    const [c, r] = await Promise.allSettled([
      getJSON<PublicCenter>('/public/center'),
      getJSON<Reviews>('/public/reviews'),
    ]);
    if (c.status === 'fulfilled') setCenter(c.value);
    if (r.status === 'fulfilled') setReviews(r.value);
    const [cls, te] = await Promise.allSettled([
      getJSON<PublicClassItem[]>('/public/classes'),
      getJSON<PublicTeacher[]>('/public/teachers'),
    ]);
    if (cls.status === 'fulfilled') setCourses(cls.value);
    setCoursesStatus(cls.status === 'fulfilled' ? 'ready' : 'error');
    if (te.status === 'fulfilled') setTeachers(te.value);
    setTeachersStatus(te.status === 'fulfilled' ? 'ready' : 'error');
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  const openForm = (mode: FormMode, classId?: number) => {
    setFormMode(mode);
    if (classId !== undefined) setTrialClassId(classId);
    formRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const name = center?.name || 'EduCenter Pro';
  const reviewItems = (reviews?.items ?? []).filter((r) => r.comment);
  const avgSize = courses.length
    ? Math.round(courses.reduce((s, c) => s + c.student_count, 0) / courses.length)
    : 0;
  const minFee = courses.length ? Math.min(...courses.map((c) => c.tuition_fee)) : 0;
  const subjects = Array.from(
    new Set([...courses.map((c) => c.name), ...teachers.map((te) => te.subject).filter(Boolean)] as string[])
  );

  // Chuyển động chỉ chạy khi người dùng không bật giảm chuyển động (WCAG 2.3.3).
  // Intro hero chạy một lần; vé lịch học mount sau khi có dữ liệu nên có animation riêng.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.lp-hero-line', { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.08 });
        gsap.from('.lp-hero-fade', { y: 16, opacity: 0, duration: 0.9, ease: 'power3.out', delay: 0.35 });
      });
      return () => mm.revert();
    },
    { scope: rootRef }
  );

  // Phần cuộn phụ thuộc dữ liệu: ScrollTrigger phải đo lại sau khi danh sách khóa học/giáo viên render.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.lp-ticket', {
          y: 60,
          opacity: 0,
          duration: 1.2,
          ease: 'expo.out',
          clearProps: 'transform,translate,rotate,opacity',
        });
        gsap.fromTo(
          '.lp-scrub-word',
          { opacity: 0.12 },
          {
            opacity: 1,
            ease: 'none',
            stagger: 0.05,
            scrollTrigger: { trigger: '.lp-scrub', start: 'top 75%', end: 'bottom 45%', scrub: true },
          }
        );
        gsap.utils.toArray<HTMLElement>('.lp-reveal').forEach((el) => {
          gsap.from(el, {
            y: 40,
            opacity: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          });
        });
      });
      return () => mm.revert();
    },
    {
      scope: rootRef,
      dependencies: [coursesStatus, teachersStatus, reviewItems.length],
      revertOnUpdate: true,
    }
  );

  return (
    <main className="lp" id="top" ref={rootRef}>
      <Nav name={name} hasReviews={reviewItems.length > 0} />

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1 className="lp-h1">
            <span className="lp-hero-mask">
              <span className="lp-hero-line">{t('hero.line1')}</span>
            </span>{' '}
            <span className="lp-hero-mask">
              <span className="lp-hero-line">{t('hero.line2')}</span>
            </span>
          </h1>
          <p className="lp-hero-sub lp-hero-fade">{t('hero.sub')}</p>
          <div className="lp-hero-cta lp-hero-fade">
            <button className="lp-btn lp-btn-ink lp-btn-lg" onClick={() => openForm('trial')}>
              {t('hero.ctaTrial')}
              <Icon name="send" size={16} aria-hidden="true" />
            </button>
            <button className="lp-btn lp-btn-line lp-btn-lg" onClick={() => openForm('lead')}>
              {t('hero.ctaConsult')}
            </button>
          </div>
        </div>
        {courses.length > 0 && (
          <aside className="lp-ticket" aria-label={t('ticket.title')}>
            <div className="lp-ticket-head">
              <span>{name}</span>
              <span>{t('ticket.title')}</span>
            </div>
            <ul>
              {courses.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>
                  <span>{c.schedule_text || t('courses.scheduleTbd')}</span>
                  <span className="lp-num">{formatVND(c.tuition_fee)}</span>
                </li>
              ))}
            </ul>
            {courses.length > 3 && (
              <a className="lp-ticket-more" href="#khoa-hoc">
                {t('ticket.more', { count: courses.length - 3 })}
              </a>
            )}
          </aside>
        )}
      </section>

      {subjects.length > 0 && <Marquee items={subjects} />}

      <section className="lp-section" aria-labelledby="lp-why">
        <h2 id="lp-why" className="lp-h2 lp-reveal">
          {t('why.title')}
        </h2>
        <div className="lp-bento">
          <article className="lp-cell lp-cell-a lp-reveal">
            {avgSize > 0 && (
              <p className="lp-big lp-num" aria-hidden="true">
                {avgSize}
              </p>
            )}
            <div>
              <h3>{t('why.small.title')}</h3>
              <p>{avgSize > 0 ? t('why.small.bodyCount', { count: avgSize }) : t('why.small.body')}</p>
            </div>
          </article>
          <article className="lp-cell lp-cell-b lp-reveal">
            <Icon name="bell" size={22} aria-hidden="true" />
            <h3>{t('why.zalo.title')}</h3>
            <p>{t('why.zalo.body')}</p>
          </article>
          <article className="lp-cell lp-cell-c lp-reveal">
            <Icon name="wallet" size={22} aria-hidden="true" />
            <h3>{t('why.fee.title')}</h3>
            <p>{minFee > 0 ? t('why.fee.bodyFrom', { fee: formatVND(minFee) }) : t('why.fee.body')}</p>
          </article>
          <article className="lp-cell lp-cell-d lp-reveal">
            <div>
              <h3>{t('why.portal.title')}</h3>
              <p>{t('why.portal.body')}</p>
            </div>
            <Link className="lp-btn lp-btn-paper" to="/parent/login">
              {t('why.portal.cta')}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </article>
        </div>
      </section>

      <section className="lp-band" aria-label={t('scrub.label')}>
        <p className="lp-scrub">
          {t('scrub.text')
            .split(' ')
            .map((w, i) => (
              <span key={i} className="lp-scrub-word">
                {w}{' '}
              </span>
            ))}
        </p>
      </section>

      <section className="lp-section lp-split" id="khoa-hoc" aria-labelledby="lp-courses">
        <div className="lp-split-pin">
          <h2 id="lp-courses" className="lp-h2">
            {t('courses.title')}
          </h2>
          <p className="lp-muted">{t('courses.sub')}</p>
          {coursesStatus === 'ready' && courses.length > 0 && (
            <p className="lp-count lp-num">{t('courses.count', { count: courses.length })}</p>
          )}
        </div>
        <div className="lp-split-list">
          {coursesStatus === 'loading' ? (
            <div aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="lp-course">
                  <Skeleton width="55%" height={28} radius={6} />
                  <Skeleton width="80%" height={14} radius={6} />
                </div>
              ))}
            </div>
          ) : coursesStatus === 'error' ? (
            <LoadFailed onRetry={() => void loadPublic()} />
          ) : courses.length === 0 ? (
            <p className="lp-muted">{t('courses.empty')}</p>
          ) : (
            <ul className="lp-course-list">
              {courses.map((c) => (
                <li key={c.id} className="lp-course lp-reveal">
                  <h3>{c.name}</h3>
                  <dl>
                    <div>
                      <dt>{t('courses.teacher')}</dt>
                      <dd>{c.teacher_name || t('courses.teacherTbd')}</dd>
                    </div>
                    <div>
                      <dt>{t('courses.schedule')}</dt>
                      <dd>{c.schedule_text || t('courses.scheduleTbd')}</dd>
                    </div>
                    <div>
                      <dt>{t('courses.tuition')}</dt>
                      <dd className="lp-num">{formatVND(c.tuition_fee)}</dd>
                    </div>
                    <div>
                      <dt>{t('courses.capacity')}</dt>
                      <dd className="lp-num">{t('courses.students', { count: c.student_count })}</dd>
                    </div>
                  </dl>
                  <button
                    className="lp-btn lp-btn-line"
                    onClick={() => openForm('trial', c.id)}
                    aria-label={t('courses.trialFor', { name: c.name })}
                  >
                    {t('courses.trial')}
                    <span aria-hidden="true">&rarr;</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="lp-section" id="giao-vien" aria-labelledby="lp-teachers">
        <div className="lp-head-row lp-reveal">
          <h2 id="lp-teachers" className="lp-h2">
            {t('teachers.title')}
          </h2>
          <p className="lp-muted">{t('teachers.sub')}</p>
        </div>
        {teachersStatus === 'loading' ? (
          <Skeleton height={320} radius={20} />
        ) : teachersStatus === 'error' ? (
          <LoadFailed onRetry={() => void loadPublic()} />
        ) : teachers.length === 0 ? (
          <p className="lp-muted">{t('teachers.empty')}</p>
        ) : (
          <ul className="lp-accordion lp-reveal">
            {teachers.map((te, i) => (
              // tabIndex: bàn phím cũng mở được ô (hover chỉ là hiệu ứng, nội dung luôn có cho screen reader)
              <li key={i} className="lp-slice" tabIndex={0}>
                <span className="lp-slice-mono" aria-hidden="true">
                  {initials(te.name)}
                </span>
                <span className="lp-slice-vert" aria-hidden="true">
                  {te.name}
                </span>
                <span className="lp-slice-body">
                  <span className="lp-slice-name">{te.name}</span>
                  <span className="lp-slice-subject">{te.subject || t('teachers.fallback')}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reviewItems.length > 0 && reviews && (
        <section className="lp-section" id="danh-gia" aria-labelledby="lp-reviews">
          <Testimonials items={reviewItems} avg={reviews.avg} total={reviews.total} />
        </section>
      )}

      <section className="lp-cta" aria-labelledby="lp-cta-title">
        <div className="lp-cta-copy">
          <h2 id="lp-cta-title" className="lp-cta-title lp-reveal">
            {t('cta.title')}
          </h2>
          <p className="lp-cta-sub">{t('cta.sub')}</p>
          {center?.phone && (
            <a className="lp-cta-phone lp-num" href={`tel:${center.phone.replace(/\s+/g, '')}`}>
              <Icon name="phone" size={18} aria-hidden="true" />
              {center.phone}
            </a>
          )}
        </div>
        <div className="lp-form-wrap" ref={formRef} id="dang-ky">
          <Tabs<FormMode>
            id="lp-form"
            label={t('formTitle')}
            className="lp-tabs"
            value={formMode}
            onChange={setFormMode}
            tabs={[
              { key: 'trial', label: t('trial.title') },
              { key: 'lead', label: t('lead.title') },
            ]}
          />
          <div {...tabPanelProps('lp-form', formMode)}>
            {/* Giữ cả 2 form trong DOM: đổi tab không làm mất dữ liệu đang nhập */}
            <div hidden={formMode !== 'trial'}>
              <TrialForm
                refCode={searchParams.get('ref') || ''}
                courses={courses}
                preselectClassId={trialClassId}
              />
            </div>
            <div hidden={formMode !== 'lead'}>
              <LeadForm />
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <strong>{name}</strong>
          {center?.address && <span>{center.address}</span>}
          {center?.phone && <span className="lp-num">{center.phone}</span>}
        </div>
        <nav className="lp-footer-links" aria-label={t('footer.label')}>
          <a href="#khoa-hoc">{t('nav.courses')}</a>
          <a href="#giao-vien">{t('nav.teachers')}</a>
          {reviewItems.length > 0 && <a href="#danh-gia">{t('nav.reviews')}</a>}
          <Link to="/parent/login">{t('nav.parent')}</Link>
          <Link to="/login">{t('footer.staff')}</Link>
        </nav>
        <p className="lp-footer-copy">
          &copy; {new Date().getFullYear()} {name}
        </p>
      </footer>
    </main>
  );
}

function Nav({ name, hasReviews }: { name: string; hasReviews: boolean }) {
  const { t } = useTranslation('landing');
  const menuRef = useRef<HTMLDetailsElement>(null);
  // Bấm 1 link trong menu mobile thì đóng menu (details không tự đóng khi nhảy anchor)
  const close = () => menuRef.current?.removeAttribute('open');
  // Hành vi menu chuẩn: bấm ra ngoài hoặc Esc thì đóng; Esc trả focus về nút menu
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !menuRef.current?.open) return;
      close();
      menuRef.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const links = (
    <>
      <a href="#khoa-hoc" onClick={close}>
        {t('nav.courses')}
      </a>
      <a href="#giao-vien" onClick={close}>
        {t('nav.teachers')}
      </a>
      {hasReviews && (
        <a href="#danh-gia" onClick={close}>
          {t('nav.reviews')}
        </a>
      )}
      <Link to="/parent/login">{t('nav.parent')}</Link>
    </>
  );
  return (
    <header className="lp-nav">
      <a className="lp-brand" href="#top">
        <span className="lp-brand-mark" aria-hidden="true">
          {initials(name).slice(0, 1)}
        </span>
        <span className="lp-brand-name">{name}</span>
      </a>
      <nav className="lp-nav-links" aria-label={t('nav.label')}>
        {links}
      </nav>
      <div className="lp-nav-end">
        <ThemeLangSwitch />
        <Link className="lp-btn lp-btn-ink lp-btn-sm" to="/login">
          {t('nav.login')}
        </Link>
        <details className="lp-menu" ref={menuRef}>
          <summary aria-label={t('nav.menu')}>
            <Icon name="menu" size={20} aria-hidden="true" />
          </summary>
          <nav className="lp-menu-panel" aria-label={t('nav.label')}>
            {links}
            <div className="lp-menu-switch">
              <ThemeLangSwitch />
            </div>
          </nav>
        </details>
      </div>
    </header>
  );
}

function Marquee({ items }: { items: string[] }) {
  // Lặp đủ dài để một nửa track luôn phủ kín màn hình rộng, rồi nhân đôi cho vòng lặp liền mạch
  const base = Array.from({ length: Math.max(1, Math.ceil(8 / items.length)) }, () => items).flat();
  const row = (hidden: boolean) => (
    <ul className="lp-marquee-row" aria-hidden={hidden || undefined}>
      {base.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
  return (
    <div className="lp-marquee">
      <div className="lp-marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

function Testimonials({ items, avg, total }: { items: PublicReview[]; avg: number; total: number }) {
  const { t } = useTranslation('landing');
  const [i, setI] = useState(0);
  const r = items[i];
  const go = (d: number) => setI((v) => (v + d + items.length) % items.length);
  return (
    <div className="lp-quotes">
      <div className="lp-quotes-side lp-reveal">
        <h2 id="lp-reviews" className="lp-h2">
          {t('reviews.title')}
        </h2>
        <p className="lp-rating">
          <span className="lp-num">{avg.toFixed(1)}</span>
          <Stars rating={avg} />
          <span className="lp-muted">{t('reviews.count', { total })}</span>
        </p>
        <div className="lp-faces" aria-hidden="true">
          {items.slice(0, 4).map((x, k) => (
            <span key={k} className={k === i ? 'on' : undefined}>
              {initials(x.parent_name || t('reviews.fallbackName'))}
            </span>
          ))}
        </div>
      </div>
      <figure className="lp-quote">
        <blockquote aria-live="polite" key={i}>
          <p>{r.comment}</p>
        </blockquote>
        <figcaption>
          <span>{r.parent_name || t('reviews.fallbackName')}</span>
          <Stars rating={r.rating} />
        </figcaption>
        {items.length > 1 && (
          <div className="lp-quote-nav">
            <button className="lp-icon-btn" onClick={() => go(-1)} aria-label={t('reviews.prev')}>
              <span aria-hidden="true">&larr;</span>
            </button>
            <span className="lp-num lp-muted">
              {i + 1} / {items.length}
            </span>
            <button className="lp-icon-btn" onClick={() => go(1)} aria-label={t('reviews.next')}>
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        )}
      </figure>
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  const { t } = useTranslation('landing');
  return (
    <button className="lp-btn lp-btn-ink lp-btn-lg lp-btn-block" type="submit" disabled={busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? t('sending') : label}
    </button>
  );
}

function LeadForm() {
  const { t } = useTranslation('landing');
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
      toastApiError(toast, err, t('lead.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="lp-form" onSubmit={submit}>
      <p className="lp-form-desc">{t('lead.desc')}</p>
      <div className="form-grid">
        <Field label={t('fields.name')} span required>
          <input
            className="text-input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('fields.phone')} span required>
          <input
            className="text-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <Field label={t('fields.note')} span>
          <textarea className="text-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <SubmitButton busy={busy} label={t('lead.submit')} />
    </form>
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
  const { t } = useTranslation('landing');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classId, setClassId] = useState(preselectClassId !== null ? String(preselectClassId) : '');
  const [desiredDate, setDesiredDate] = useState('');
  const [note, setNote] = useState('');
  const [referralCode, setReferralCode] = useState(refCode);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
      toastApiError(toast, err, t('trial.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="lp-form" onSubmit={submit}>
      <p className="lp-form-desc">{t('trial.desc')}</p>
      <div className="form-grid">
        <Field label={t('fields.name')} required>
          <input
            className="text-input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('fields.phone')} required>
          <input
            className="text-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
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
          <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <SubmitButton busy={busy} label={t('trial.submit')} />
    </form>
  );
}
