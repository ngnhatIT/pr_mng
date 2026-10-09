import { useEffect, useMemo, useState } from 'react';
import {
  homeworkApi,
  type QuizQuestionForm,
  type Rubric,
} from './homework.api';
import { ClassItem } from '../classes/classes.api';
import { studentsApi } from '../students/students.api';
import { HomeworkItem, formatDate } from '../../shared/types';
import type { Student } from '../students/students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { RichTextarea } from '../../shared/components/RichTextarea';
import { QuestionBank } from './QuestionBank';
import type { BankQuestion } from './homework.api';

const TEMPLATES = [
  { name: 'Ôn từ vựng', title: 'Ôn tập từ vựng bài {n}', content: '1. Học thuộc 20 từ vựng mới trong bài\n2. Viết mỗi từ 3 lần vào vở\n3. Đặt câu với 5 từ bất kỳ' },
  { name: 'Làm bài tập SGK', title: 'Bài tập SGK trang {n}', content: 'Hoàn thành các bài tập trang {n} sách giáo khoa.\nChụp ảnh bài làm gửi cho giáo viên.' },
  { name: 'Luyện nghe', title: 'Luyện nghe bài {n}', content: '1. Nghe audio 3 lần\n2. Điền từ còn thiếu\n3. Ghi âm lại đoạn hội thoại' },
];

function quickDate(kind: 'today' | 'tomorrow' | 'weekend' | 'nextweek'): string {
  const d = new Date();
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
  if (kind === 'weekend') d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  if (kind === 'nextweek') d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

interface Attachment {
  name: string;
  url: string;
  kind: string;
}

export function HomeworkFormModal({
  classes,
  initial,
  onClose,
  onSaved,
}: {
  classes: ClassItem[];
  initial: HomeworkItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<'homework' | 'quiz'>(initial?.kind || 'homework');
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [dueDate, setDueDate] = useState(initial?.due_date?.slice(0, 10) || '');
  const [closeDate, setCloseDate] = useState(initial?.close_date?.slice(0, 10) || '');
  const [maxScore, setMaxScore] = useState(initial?.max_score?.toString() || '');
  const [selectedClasses, setSelectedClasses] = useState<number[]>(initial ? [initial.class_id] : []);
  const [classSearch, setClassSearch] = useState('');
  // Đối tượng: cả lớp hoặc chọn riêng từng em
  const [targetMode, setTargetMode] = useState<'all' | 'selected'>('all');
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  // Đính kèm
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attName, setAttName] = useState('');
  const [attUrl, setAttUrl] = useState('');
  // Rubric
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [rubricId, setRubricId] = useState<string>(initial?.rubric_id?.toString() || '');
  const [showRubricForm, setShowRubricForm] = useState(false);
  const [newRubricName, setNewRubricName] = useState('');
  const [newCriteria, setNewCriteria] = useState<{ name: string; max_score: string }[]>([
    { name: 'Phát âm', max_score: '10' },
    { name: 'Từ vựng', max_score: '10' },
  ]);
  // Quiz builder
  const [questions, setQuestions] = useState<QuizQuestionForm[]>([
    { question: '', points: 1, options: [{ text: '', is_correct: true }, { text: '', is_correct: false }] },
  ]);
  const [quizLocked, setQuizLocked] = useState(false); // đã có người làm → không sửa đề

  // Khi sửa quiz: tải đề cũ (kèm đáp án đúng) để không vô tình xóa
  useEffect(() => {
    if (initial && initial.kind === 'quiz') {
      homeworkApi
        .getQuizEdit(initial.id)
        .then((qs) => {
          if (qs.length > 0) {
            setQuestions(
              qs.map((q) => ({
                question: q.question,
                points: q.points,
                options: q.options.map((o) => ({ text: o.text, is_correct: !!o.is_correct })),
              }))
            );
          }
        })
        .catch(() => {});
      // Kiểm tra đã có lượt làm chưa
      homeworkApi
        .getQuizAttempts(initial.id)
        .then((a) => setQuizLocked(a.length > 0))
        .catch(() => {});
    }
  }, [initial]);
  // Xuất bản
  const [publishMode, setPublishMode] = useState<'now' | 'draft' | 'schedule'>('now');
  const [publishAt, setPublishAt] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);

  const importBankQuestions = (bank: BankQuestion[]) => {
    const mapped = bank.map((b) => ({
      question: b.question,
      points: b.points,
      options: b.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
    }));
    setQuestions((qs) => {
      const onlyEmpty = qs.length === 1 && !qs[0].question.trim();
      return onlyEmpty ? mapped : [...qs, ...mapped];
    });
    toast(`Đã thêm ${mapped.length} câu từ ngân hàng`, 'success');
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    homeworkApi.listRubrics().then(setRubrics).catch(() => {});
  }, []);

  // Load học viên của các lớp đã chọn (cho giao riêng)
  useEffect(() => {
    if (targetMode !== 'selected' || !selectedClasses.length) return;
    studentsApi
      .list('', '', { page: 1, limit: 200 })
      .then((r) => setStudents(r.data))
      .catch(() => {});
  }, [targetMode, selectedClasses]);

  const filteredClasses = useMemo(
    () => classes.filter((c) => c.name.toLowerCase().includes(classSearch.toLowerCase())),
    [classes, classSearch]
  );
  const filteredStudents = useMemo(
    () => students.filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase())),
    [students, studentSearch]
  );

  const toggleClass = (id: number) =>
    setSelectedClasses((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleStudent = (id: number) =>
    setSelectedStudents((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const addAttachment = () => {
    if (!attName.trim() || !attUrl.trim()) {
      toast('Nhập tên và link đính kèm', 'error');
      return;
    }
    setAttachments((a) => [...a, { name: attName.trim(), url: attUrl.trim(), kind: 'link' }]);
    setAttName('');
    setAttUrl('');
  };

  const createRubricNow = async () => {
    try {
      const r = await homeworkApi.createRubric(newRubricName.trim(), newCriteria.map((c) => ({
        name: c.name.trim(),
        max_score: Number(c.max_score) || 0,
      })));
      setRubrics((rs) => [r, ...rs]);
      setRubricId(String(r.id));
      setShowRubricForm(false);
      setNewRubricName('');
      toast('Đã tạo rubric', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo rubric thất bại', 'error');
    }
  };

  // Quiz builder helpers
  const addQuestion = () =>
    setQuestions((q) => [...q, { question: '', points: 1, options: [{ text: '', is_correct: true }, { text: '', is_correct: false }] }]);
  const updateQuestion = (i: number, patch: Partial<QuizQuestionForm>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const addOption = (qi: number) =>
    setQuestions((qs) => qs.map((q, j) => (j === qi ? { ...q, options: [...q.options, { text: '', is_correct: false }] } : q)));
  const updateOption = (qi: number, oi: number, patch: Partial<{ text: string; is_correct: boolean }>) =>
    setQuestions((qs) =>
      qs.map((q, j) =>
        j === qi
          ? {
              ...q,
              options: q.options.map((o, k) =>
                k === oi ? { ...o, ...patch } : patch.is_correct ? { ...o, is_correct: false } : o
              ),
            }
          : q
      )
    );
  const removeOption = (qi: number, oi: number) =>
    setQuestions((qs) => qs.map((q, j) => (j === qi ? { ...q, options: q.options.filter((_, k) => k !== oi) } : q)));

  const selectedRubric = rubrics.find((r) => String(r.id) === rubricId);
  const quizTotal = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);

  const canSubmit =
    title.trim().length > 0 &&
    (initial ? true : selectedClasses.length > 0) &&
    (publishMode !== 'schedule' || publishAt) &&
    (targetMode !== 'selected' || selectedStudents.length > 0) &&
    (kind !== 'quiz' || questions.every((q) => q.question.trim() && q.options.length >= 2 && q.options.some((o) => o.is_correct && o.text.trim())));

  const submit = async (publishOverride?: 'now' | 'draft' | 'schedule') => {
    const mode = publishOverride || publishMode;
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const status = mode === 'now' ? 'published' : mode === 'draft' ? 'draft' : 'scheduled';
      if (initial) {
        await homeworkApi.update(initial.id, {
          title: title.trim(),
          content: content.trim() || null,
          due_date: dueDate || null,
          max_score: maxScore ? Number(maxScore) : null,
          close_date: closeDate || null,
          rubric_id: rubricId ? Number(rubricId) : null,
        });
        if (kind === 'quiz') await homeworkApi.saveQuiz(initial.id, questions);
        toast('Đã cập nhật', 'success');
      } else {
        const res = await homeworkApi.create({
          class_ids: selectedClasses,
          title: title.trim(),
          content: content.trim() || null,
          due_date: dueDate || null,
          status,
          publish_at: status === 'scheduled' ? publishAt : null,
          max_score: maxScore ? Number(maxScore) : null,
          close_date: closeDate || null,
          kind,
          rubric_id: rubricId ? Number(rubricId) : null,
          attachments,
          target_student_ids: targetMode === 'selected' ? selectedStudents : [],
          questions: kind === 'quiz' ? questions : [],
        });
        toast(
          status === 'draft' ? 'Đã lưu nháp' : status === 'scheduled' ? `Đã hẹn đăng ${res.count} lớp` : `Đã giao cho ${res.count} lớp`,
          'success'
        );
      }
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Sửa bài tập' : 'Tạo bài tập mới'} onClose={onClose} wide>
      {/* Loại bài tập */}
      {!initial && (
        <div className="kind-switcher">
          <button
            type="button"
            className={`kind-btn ${kind === 'homework' ? 'kind-active' : ''}`}
            onClick={() => setKind('homework')}
          >
            📝 Bài tập thường
          </button>
          <button
            type="button"
            className={`kind-btn ${kind === 'quiz' ? 'kind-active' : ''}`}
            onClick={() => setKind('quiz')}
          >
            ✅ Quiz trắc nghiệm
          </button>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {/* Chọn lớp */}
        {!initial && (
          <Field label={`Chọn lớp (${selectedClasses.length} đã chọn) *`}>
            <input className="text-input" placeholder="Tìm lớp..." value={classSearch}
              onChange={(e) => setClassSearch(e.target.value)} style={{ marginBottom: 8 }} />
            <div className="chip-grid">
              {filteredClasses.map((c) => {
                const active = selectedClasses.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`chip ${active ? 'chip-active' : ''}`}
                    onClick={() => toggleClass(c.id)}>
                    {active ? '✓ ' : ''}{c.name}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setSelectedClasses(classes.map((c) => c.id))}>Chọn tất cả</button>
              <button type="button" className="btn btn-sm" onClick={() => setSelectedClasses([])}>Bỏ chọn</button>
            </div>
          </Field>
        )}

        {/* Đối tượng */}
        {!initial && (
          <Field label="Giao cho">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button type="button" className={`btn btn-sm ${targetMode === 'all' ? 'btn-primary' : ''}`}
                onClick={() => setTargetMode('all')}>Cả lớp</button>
              <button type="button" className={`btn btn-sm ${targetMode === 'selected' ? 'btn-primary' : ''}`}
                onClick={() => setTargetMode('selected')}>Chọn riêng từng em</button>
            </div>
            {targetMode === 'selected' && (
              <>
                <input className="text-input" placeholder="Tìm học viên..." value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)} style={{ marginBottom: 8 }} />
                <div className="chip-grid">
                  {filteredStudents.map((s) => {
                    const active = selectedStudents.includes(s.id);
                    return (
                      <button key={s.id} type="button" className={`chip ${active ? 'chip-active' : ''}`}
                        onClick={() => toggleStudent(s.id)}>
                        {active ? '✓ ' : ''}{s.name}
                      </button>
                    );
                  })}
                  {filteredStudents.length === 0 && <span className="muted">Không tìm thấy</span>}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Đã chọn {selectedStudents.length} em</div>
              </>
            )}
          </Field>
        )}

        {/* Mẫu nhanh */}
        {!initial && kind === 'homework' && (
          <Field label="Mẫu nhanh">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TEMPLATES.map((t) => (
                <button key={t.name} type="button" className="btn btn-sm"
                  onClick={() => { setTitle(t.title); setContent(t.content); }}>{t.name}</button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Tiêu đề *">
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'quiz' ? 'VD: Quiz từ vựng Unit 5' : 'VD: Ôn tập từ vựng Unit 5'}
            maxLength={200} required />
        </Field>

        {kind === 'homework' && (
          <Field label={`Nội dung (${content.length}/5000)`}>
            <RichTextarea value={content} rows={5}
              onChange={(v) => setContent(v.slice(0, 5000))}
              placeholder={'Chi tiết bài tập...\n1. ...\n2. ...'} />
          </Field>
        )}

        {/* Điểm + Hạn */}
        <div className="form-grid">
          <Field label="Điểm tối đa">
            <input className="text-input" type="number" min="0" step="0.5" value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)} placeholder="VD: 10 (trống = không chấm)" />
          </Field>
          <Field label="Hạn nộp">
            <input className="text-input" type="date" value={dueDate}
              min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Hạn nhanh">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([['today', 'Hôm nay'], ['tomorrow', 'Ngày mai'], ['weekend', 'Cuối tuần'], ['nextweek', 'Tuần sau']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`btn btn-sm ${dueDate === quickDate(k) ? 'btn-primary' : ''}`}
                  onClick={() => setDueDate(quickDate(k))}>{label}</button>
              ))}
              {dueDate && <button type="button" className="btn btn-sm" onClick={() => setDueDate('')}>Xóa</button>}
            </div>
          </Field>
          <Field label="Hạn chót cứng">
            <input className="text-input" type="date" value={closeDate}
              min={dueDate || new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCloseDate(e.target.value)} />
            <div className="muted" style={{ fontSize: 12 }}>Qua ngày này khóa nộp bài</div>
          </Field>
        </div>

        {/* Đính kèm */}
        {kind === 'homework' && (
          <Field label="Đính kèm (link tài liệu, audio, video)">
            {attachments.map((a, i) => (
              <div key={i} className="att-row">
                <span>📎 {a.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{a.url.slice(0, 40)}...</span>
                <button type="button" className="btn btn-sm btn-danger-ghost"
                  onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}>Xóa</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="text-input" placeholder="Tên (VD: Audio bài nghe)" value={attName}
                onChange={(e) => setAttName(e.target.value)} />
              <input className="text-input" placeholder="Link https://..." value={attUrl}
                onChange={(e) => setAttUrl(e.target.value)} />
              <button type="button" className="btn" onClick={addAttachment}>+ Thêm</button>
            </div>
          </Field>
        )}

        {/* Rubric */}
        {kind === 'homework' && (
          <Field label="Rubric chấm điểm">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select className="text-input" value={rubricId} onChange={(e) => setRubricId(e.target.value)} style={{ flex: 1 }}>
                <option value="">Không dùng rubric</option>
                {rubrics.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.total_score}đ)</option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => setShowRubricForm((s) => !s)}>+ Tạo mới</button>
            </div>
            {selectedRubric && (
              <div className="rubric-preview">
                {selectedRubric.criteria.map((c) => (
                  <div key={c.id} className="rubric-row"><span>{c.name}</span><span className="num">{c.max_score}đ</span></div>
                ))}
              </div>
            )}
            {showRubricForm && (
              <div className="rubric-form">
                <input className="text-input" placeholder="Tên rubric (VD: Chấm bài nói)" value={newRubricName}
                  onChange={(e) => setNewRubricName(e.target.value)} style={{ marginBottom: 8 }} />
                {newCriteria.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input className="text-input" placeholder="Tiêu chí" value={c.name}
                      onChange={(e) => setNewCriteria((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                    <input className="text-input" type="number" min="0" placeholder="Điểm" value={c.max_score} style={{ width: 100 }}
                      onChange={(e) => setNewCriteria((x) => x.map((y, j) => (j === i ? { ...y, max_score: e.target.value } : y)))} />
                    <button type="button" className="btn btn-sm btn-danger-ghost"
                      onClick={() => setNewCriteria((x) => x.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-sm"
                    onClick={() => setNewCriteria((x) => [...x, { name: '', max_score: '10' }])}>+ Thêm tiêu chí</button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={createRubricNow}>Lưu rubric</button>
                </div>
              </div>
            )}
          </Field>
        )}

        {/* Quiz builder */}
        {kind === 'quiz' && (
          <Field label={`Câu hỏi trắc nghiệm (${questions.length} câu, tổng ${quizTotal}đ)`}>
            {quizLocked && (
              <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                ⚠️ Đã có học viên làm bài — không thể sửa đề. Hãy tạo quiz mới nếu cần thay đổi.
              </div>
            )}
            {questions.map((q, qi) => (
              <div key={qi} className="quiz-q">
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span className="quiz-num">{qi + 1}</span>
                  <input className="text-input" placeholder={`Câu hỏi ${qi + 1}`} value={q.question}
                    onChange={(e) => updateQuestion(qi, { question: e.target.value })} style={{ flex: 1 }} />
                  <input className="text-input" type="number" min="0.5" step="0.5" value={q.points} style={{ width: 80 }}
                    onChange={(e) => updateQuestion(qi, { points: Number(e.target.value) || 1 })} title="Điểm" />
                  {questions.length > 1 && (
                    <button type="button" className="btn btn-sm btn-danger-ghost"
                      onClick={() => setQuestions((x) => x.filter((_, j) => j !== qi))}>×</button>
                  )}
                </div>
                {q.options.map((o, oi) => (
                  <div key={oi} className="quiz-opt">
                    <button
                      type="button"
                      className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
                      onClick={() => updateOption(qi, oi, { is_correct: true })}
                      title="Đáp án đúng"
                    >{o.is_correct ? '●' : '○'}</button>
                    <input className="text-input input-sm" placeholder={`Đáp án ${String.fromCharCode(65 + oi)}`}
                      value={o.text} onChange={(e) => updateOption(qi, oi, { text: e.target.value })} style={{ flex: 1 }} />
                    {q.options.length > 2 && (
                      <button type="button" className="btn btn-sm btn-danger-ghost"
                        onClick={() => removeOption(qi, oi)}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => addOption(qi)} style={{ marginTop: 4 }}>
                  + Thêm đáp án
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={addQuestion}>+ Thêm câu hỏi</button>
              <button type="button" className="btn" onClick={() => setShowBankPicker(true)}>
                🏦 Lấy từ ngân hàng
              </button>
            </div>
          </Field>
        )}

        {/* Xuất bản */}
        {!initial && (
          <Field label="Đăng bài">
            <div className="publish-options">
              {([['now', 'Đăng ngay'], ['schedule', 'Hẹn giờ đăng'], ['draft', 'Lưu nháp']] as const).map(([m, label]) => (
                <button key={m} type="button"
                  className={`publish-btn ${publishMode === m ? 'active' : ''}`}
                  onClick={() => setPublishMode(m)}>{label}</button>
              ))}
            </div>
            {publishMode === 'schedule' && (
              <input className="text-input" type="datetime-local" value={publishAt}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(e) => setPublishAt(e.target.value)} style={{ marginTop: 8 }} />
            )}
          </Field>
        )}

        {/* Preview */}
        {showPreview && (
          <div className="preview-box">
            <div className="preview-label">Xem trước</div>
            <div className="card" style={{ margin: 0 }}>
              <div className="card-head">
                <h2>{title || '(Chưa có tiêu đề)'}</h2>
                {dueDate && <span className="badge badge-upcoming">Hạn: {formatDate(dueDate)}</span>}
              </div>
              {content && <p className="homework-content">{content}</p>}
              {maxScore && <p className="muted">Điểm tối đa: {maxScore}</p>}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? 'Ẩn xem trước' : 'Xem trước'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          {initial ? (
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || busy}>
              {busy ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={!canSubmit || busy}
                onClick={() => void submit('draft')}>Lưu nháp</button>
              <button type="submit" className="btn btn-primary" disabled={!canSubmit || busy}>
                {busy ? 'Đang xử lý...' : publishMode === 'schedule' ? `Hẹn đăng (${selectedClasses.length} lớp)` : `Đăng cho ${selectedClasses.length} lớp`}
              </button>
            </>
          )}
        </div>
      </form>
      {showBankPicker && (
        <QuestionBank
          onClose={() => setShowBankPicker(false)}
          selectMode
          onImport={importBankQuestions}
        />
      )}
    </Modal>
  );
}
