import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { http } from '../../shared/api/client';
import { PublicCenter, PublicClassItem, PublicTeacher, PublicReview, formatVND } from '../../shared/types';
import './Landing.css';

async function getJSON<T>(path: string): Promise<T> {
  try {
    return await http.get<T>(path);
  } catch {
    throw new Error('Không tải được dữ liệu');
  }
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating}/5 sao`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={16} filled className={i <= full ? 'star on' : 'star'} />
      ))}
    </span>
  );
}

export function Landing() {
  const [searchParams] = useSearchParams();
  const [center, setCenter] = useState<PublicCenter | null>(null);
  const [courses, setCourses] = useState<PublicClassItem[]>([]);
  const [teachers, setTeachers] = useState<PublicTeacher[]>([]);
  const [reviews, setReviews] = useState<{ avg: number; total: number; items: PublicReview[] } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, cls, t, r] = await Promise.all([
          getJSON<PublicCenter>('/public/center'),
          getJSON<PublicClassItem[]>('/public/classes'),
          getJSON<PublicTeacher[]>('/public/teachers'),
          getJSON<{ avg: number; total: number; items: PublicReview[] }>('/public/reviews'),
        ]);
        setCenter(c);
        setCourses(cls);
        setTeachers(t);
        setReviews(r);
      } catch {
        /* trang public vẫn hiển thị phần tĩnh */
      }
    })();
  }, []);

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <div className="brand-logo">E</div>
          <span>{center?.name || 'EduCenter Pro'}</span>
        </div>
        <div className="landing-nav-links">
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#khoa-hoc">
            Khóa học
          </a>
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#giao-vien">
            Giáo viên
          </a>
          <a className="btn btn-sm btn-ghost landing-nav-anchor" href="#danh-gia">
            Đánh giá
          </a>
          <Link className="btn btn-sm" to="/parent/login">
            Cổng phụ huynh
          </Link>
          <Link className="btn btn-sm btn-primary" to="/login">
            Đăng nhập
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-badge">
          <span className="landing-badge-dot" />
          Đang tuyển sinh - đăng ký học thử miễn phí
        </div>
        <h1>{center?.name || 'Trung tâm của bạn'}</h1>
        <p className="landing-hero-sub">
          Nền tảng quản lý lớp học, học viên và học phí hiện đại - đồng hành cùng con bạn trên mỗi bước tiến.
        </p>
        <div className="landing-hero-cta">
          <button className="btn btn-primary btn-lg" onClick={scrollToForm}>
            Đăng ký tư vấn
          </button>
          <button className="btn btn-lg" onClick={scrollToForm}>
            Đăng ký học thử
          </button>
        </div>
        <div className="landing-stats">
          <div className="landing-stat">
            <div className="landing-stat-value">{courses.length}</div>
            <div className="landing-stat-label">Khóa học</div>
          </div>
          <div className="landing-stat">
            <div className="landing-stat-value">{teachers.length}</div>
            <div className="landing-stat-label">Giáo viên</div>
          </div>
          <div className="landing-stat">
            <div className="landing-stat-value">
              {reviews && reviews.total > 0 ? reviews.avg.toFixed(1) : '-'}/5
            </div>
            <div className="landing-stat-label">Đánh giá phụ huynh</div>
          </div>
        </div>
        {(center?.phone || center?.address) && (
          <p className="landing-hero-contact muted">
            {center?.phone && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="phone" size={14} /> {center.phone}
              </span>
            )}
            {center?.phone && center?.address && ' · '}
            {center?.address && <>{center.address}</>}
          </p>
        )}
      </section>

      <section className="landing-section" id="khoa-hoc">
        <div className="landing-section-head">
          <h2>Khóa học nổi bật</h2>
          <p>Chọn khóa học phù hợp với trình độ và mục tiêu của con bạn</p>
        </div>
        {courses.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center' }}>
            Đang cập nhật khóa học...
          </p>
        ) : (
          <div className="course-grid">
            {courses.map((c) => (
              <div key={c.id} className="card course-card card-hover">
                <div className="course-card-top" />
                <h3>{c.name}</h3>
                <dl className="dl dl-compact">
                  <dt>Giáo viên</dt>
                  <dd>{c.teacher_name || '-'}</dd>
                  <dt>Lịch học</dt>
                  <dd>{c.schedule_text || '-'}</dd>
                  <dt>Học phí</dt>
                  <dd>
                    <strong className="text-primary">{formatVND(c.tuition_fee)}</strong>
                  </dd>
                  <dt>Sĩ số</dt>
                  <dd>{c.student_count} học viên</dd>
                </dl>
                <button className="btn btn-primary btn-block" onClick={scrollToForm}>
                  Đăng ký học thử
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="landing-section landing-alt" id="giao-vien">
        <div className="landing-section-head">
          <h2>Đội ngũ giáo viên</h2>
          <p>Giáo viên tận tâm, giàu kinh nghiệm đồng hành cùng học viên</p>
        </div>
        {teachers.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center' }}>
            Đang cập nhật...
          </p>
        ) : (
          <div className="course-grid">
            {teachers.map((t, i) => (
              <div key={i} className="card review-card card-hover">
                <div className="teacher-avatar">{t.name.charAt(0).toUpperCase()}</div>
                <h3>{t.name}</h3>
                <p className="muted">{t.subject || 'Giáo viên'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="landing-section" id="danh-gia">
        <div className="landing-section-head">
          <h2>Phụ huynh nói gì</h2>
          <p>Đánh giá thật từ phụ huynh đang cho con theo học</p>
        </div>
        {reviews && reviews.items.length > 0 && (
          <p className="landing-avg">
            <Stars rating={reviews.avg} /> <strong>{reviews.avg.toFixed(1)}/5</strong>{' '}
            <span className="muted">({reviews.total} đánh giá)</span>
          </p>
        )}
        <div className="course-grid">
          {(reviews?.items || []).map((r, i) => (
            <div key={i} className="card review-card testimonial card-hover">
              <Stars rating={r.rating} />
              <p className="review-comment">{r.comment || '-'}</p>
              <div className="testimonial-foot">
                <div className="testimonial-avatar">{(r.parent_name || 'P').charAt(0).toUpperCase()}</div>
                <div className="muted">{r.parent_name || 'Phụ huynh'}</div>
              </div>
            </div>
          ))}
        </div>
        {(!reviews || reviews.items.length === 0) && (
          <p className="muted" style={{ textAlign: 'center' }}>
            Chưa có đánh giá nào.
          </p>
        )}
      </section>

      <section className="landing-section landing-alt" ref={formRef}>
        <h2>Đăng ký tư vấn & học thử</h2>
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
              Đăng nhập
            </Link>
            <Link className="btn btn-sm btn-primary" to="/parent/login">
              Cổng phụ huynh
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LeadForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post('/public/leads', { name, phone, note: note || undefined });
      toast('Đã gửi đăng ký tư vấn. Chúng tôi sẽ liên hệ sớm!', 'success');
      setName('');
      setPhone('');
      setNote('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">Đăng ký tư vấn</h3>
      <p className="card-desc">Để lại thông tin, trung tâm sẽ gọi lại tư vấn khóa học phù hợp.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Họ tên *" span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Số điện thoại *" span>
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label="Ghi chú" span>
            <textarea
              className="text-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Đang gửi...' : 'Gửi đăng ký tư vấn'}
        </button>
      </form>
    </div>
  );
}

function TrialForm({ refCode, courses }: { refCode: string; courses: PublicClassItem[] }) {
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
      toast('Đã đăng ký học thử thành công!', 'success');
      setName('');
      setPhone('');
      setClassId('');
      setDesiredDate('');
      setNote('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">Đăng ký học thử</h3>
      <p className="card-desc">Trải nghiệm một buổi học miễn phí trước khi quyết định.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Họ tên *">
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Số điện thoại *">
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label="Lớp muốn học thử">
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">- Chưa chọn -</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ngày mong muốn">
            <input
              className="text-input"
              type="date"
              value={desiredDate}
              onChange={(e) => setDesiredDate(e.target.value)}
            />
          </Field>
          <Field label="Mã giới thiệu">
            <input
              className="text-input"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder="Nhập mã nếu được giới thiệu"
            />
          </Field>
          <Field label="Ghi chú">
            <textarea
              className="text-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Đang gửi...' : 'Đăng ký học thử'}
        </button>
      </form>
    </div>
  );
}
