import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type QuizQuestionForm, type Rubric } from './homework.api';
import { ClassItem, classesApi } from '../classes/classes.api';
import { HomeworkItem, formatDate, todayVN, nowVN } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { RichTextarea } from '../../shared/components/RichTextarea';
import { QuestionBank } from './QuestionBank';
import type { BankQuestion } from './homework.api';

type QType = 'single' | 'multiple' | 'truefalse' | 'essay';

const BLANK_QTYPE_OPTIONS: { text: string; is_correct: boolean }[] = [
  { text: '', is_correct: true },
  { text: '', is_correct: false },
];

function quickDate(kind: 'today' | 'tomorrow' | 'weekend' | 'nextweek'): string {
  const d = new Date();
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
  if (kind === 'weekend') d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  if (kind === 'nextweek') d.setDate(d.getDate() + 7);
  // Giờ VN theo máy, xuất ra YYYY-MM-DD theo múi giờ VN (tránh lệch ngày UTC lúc 0:00-7:00)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
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
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2).
  // Nút submit KHÔNG disable khi thiếu dữ liệu: bấm sẽ hiện lỗi inline thay vì im lặng.
  type HwErrKey = 'classes' | 'title' | 'maxScore' | 'dueDate' | 'closeDate' | 'publishAt' | 'students' | 'quiz' | 'rubricName' | 'rubricCriteria';
  const { errors, refFor, show, clear } = useFieldErrors<HwErrKey>();
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
  const [students, setStudents] = useState<{ id: number; name: string }[]>([]);
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
  const templates = t('form.templates', { returnObjects: true }) as {
    name: string;
    title: string;
    content: string;
  }[];
  const defaultCriteria = t('form.defaultCriteria', { returnObjects: true }) as string[];
  const [newCriteria, setNewCriteria] = useState<{ name: string; max_score: string }[]>(() =>
    defaultCriteria.map((name) => ({ name, max_score: '10' }))
  );
  const [rubricBusy, setRubricBusy] = useState(false);
  // Quiz builder
  const [questions, setQuestions] = useState<QuizQuestionForm[]>([
    {
      question: '',
      points: 1,
      qtype: 'single',
      options: BLANK_QTYPE_OPTIONS.map((o) => ({ ...o })),
    },
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
                qtype: (q.qtype ?? 'single') as QType,
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
      qtype: b.qtype as QType,
      options: b.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
    }));
    setQuestions((qs) => {
      const onlyEmpty = qs.length === 1 && !qs[0].question.trim();
      return onlyEmpty ? mapped : [...qs, ...mapped];
    });
    toast(t('form.toast.bankImported', { count: mapped.length }), 'success');
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    homeworkApi
      .listRubrics()
      .then(setRubrics)
      .catch(() => {});
  }, []);

  // Load học viên thuộc các lớp đã chọn (cho giao riêng từng em).
  // Dùng chi tiết từng lớp để chỉ hiện học viên đang học ở các lớp đó.
  useEffect(() => {
    if (targetMode !== 'selected' || !selectedClasses.length) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    Promise.all(selectedClasses.map((id) => classesApi.get(id).catch(() => null)))
      .then((details) => {
        if (cancelled) return;
        const seen = new Set<number>();
        const merged: { id: number; name: string }[] = [];
        for (const d of details) {
          for (const s of d?.students ?? []) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              merged.push({ id: s.id, name: s.name });
            }
          }
        }
        merged.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        setStudents(merged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetMode, selectedClasses]);

  const filteredClasses = useMemo(
    () => classes.filter((c) => c.name.toLowerCase().includes(classSearch.toLowerCase())),
    [classes, classSearch]
  );
  const filteredStudents = useMemo(
    () => students.filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase())),
    [students, studentSearch]
  );

  const toggleClass = (id: number) => {
    clear('classes');
    setSelectedClasses((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const toggleStudent = (id: number) => {
    clear('students');
    setSelectedStudents((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const addAttachment = () => {
    if (!attName.trim() || !attUrl.trim()) {
      toast(t('form.toast.attRequired'), 'error');
      return;
    }
    setAttachments((a) => [...a, { name: attName.trim(), url: attUrl.trim(), kind: 'link' }]);
    setAttName('');
    setAttUrl('');
  };

  const createRubricNow = async () => {
    if (rubricBusy) return;
    // Validate inline dưới field + focus field lỗi đầu tiên (skill 8.2)
    const rerrs: { rubricName?: string; rubricCriteria?: string } = {};
    if (!newRubricName.trim()) rerrs.rubricName = t('form.errors.rubricNameRequired');
    const validCriteria = newCriteria
      .map((c) => ({ name: c.name.trim(), max_score: Number(c.max_score) || 0 }))
      .filter((c) => c.name && c.max_score > 0);
    if (validCriteria.length === 0) rerrs.rubricCriteria = t('form.errors.rubricCriteriaRequired');
    if (!show(rerrs)) return;
    setRubricBusy(true);
    try {
      const r = await homeworkApi.createRubric(newRubricName.trim(), validCriteria);
      setRubrics((rs) => [r, ...rs]);
      setRubricId(String(r.id));
      setShowRubricForm(false);
      setNewRubricName('');
      toast(t('form.toast.rubricCreated'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('form.toast.rubricFail'), 'error');
    } finally {
      setRubricBusy(false);
    }
  };

  // Quiz builder helpers
  const addQuestion = () =>
    setQuestions((q) => [
      ...q,
      {
        question: '',
        points: 1,
        qtype: 'single' as QType,
        options: BLANK_QTYPE_OPTIONS.map((o) => ({ ...o })),
      },
    ]);
  const updateQuestion = (i: number, patch: Partial<QuizQuestionForm>) => {
    clear('quiz');
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  /** Đổi loại câu hỏi: truefalse tự tạo sẵn 2 đáp án Đúng/Sai, essay ẩn đáp án. */
  const changeQuestionType = (qi: number, next: QType) => {
    clear('quiz');
    setQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== qi) return q;
        if (next === 'truefalse') {
          return {
            ...q,
            qtype: next,
            options: [
              { text: t('bank.trueLabel'), is_correct: true },
              { text: t('bank.falseLabel'), is_correct: false },
            ],
          };
        }
        if (next === 'essay') return { ...q, qtype: next, options: [] };
        const options = q.options.length >= 2 ? q.options : BLANK_QTYPE_OPTIONS.map((o) => ({ ...o }));
        // Chuyển về single: đảm bảo chỉ 1 đáp án đúng
        const fixed =
          next === 'single' && options.filter((o) => o.is_correct).length !== 1
            ? options.map((o, k) => ({ ...o, is_correct: k === 0 }))
            : options;
        return { ...q, qtype: next, options: fixed };
      })
    );
  };
  const addOption = (qi: number) =>
    setQuestions((qs) =>
      qs.map((q, j) => (j === qi ? { ...q, options: [...q.options, { text: '', is_correct: false }] } : q))
    );
  const updateOption = (qi: number, oi: number, patch: Partial<{ text: string; is_correct: boolean }>) =>
    setQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== qi) return q;
        const qtype = q.qtype ?? 'single';
        return {
          ...q,
          // single/truefalse: 1 đáp án đúng nên bỏ chọn các đáp án khác;
          // multiple: bật/tắt từng đáp án, giữ nguyên các đáp án còn lại
          options: q.options.map((o, k) =>
            k === oi
              ? { ...o, ...patch }
              : patch.is_correct && (qtype === 'single' || qtype === 'truefalse')
                ? { ...o, is_correct: false }
                : o
          ),
        };
      })
    );
  const removeOption = (qi: number, oi: number) =>
    setQuestions((qs) =>
      qs.map((q, j) => (j === qi ? { ...q, options: q.options.filter((_, k) => k !== oi) } : q))
    );

  const selectedRubric = rubrics.find((r) => String(r.id) === rubricId);
  const quizTotal = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);

  /** Validate builder theo loại câu hỏi (server validate lại từ B1). */
  const quizInvalidCount = questions.filter((q) => {
    const qtype = q.qtype ?? 'single';
    if (!q.question.trim()) return true;
    if (qtype === 'essay') return false;
    const filled = q.options.filter((o) => o.text.trim());
    if (qtype === 'truefalse')
      return filled.length !== 2 || filled.filter((o) => o.is_correct).length !== 1;
    if (filled.length < 2) return true;
    const correctCount = filled.filter((o) => o.is_correct).length;
    return qtype === 'single' ? correctCount !== 1 : correctCount < 1;
  }).length;

  // Lọc đáp án trống trước khi gửi (server cũng validate lại)
  const cleanedQuestions: QuizQuestionForm[] = questions.map((q) => ({
    ...q,
    qtype: q.qtype ?? 'single',
    options: q.qtype === 'essay' ? [] : q.options.filter((o) => o.text.trim()),
  }));

  const validate = () => {
    const errs: Partial<Record<HwErrKey, string>> = {};
    if (!initial && selectedClasses.length === 0) errs.classes = t('form.errors.classRequired');
    if (!title.trim()) errs.title = t('form.errors.titleRequired');
    if (maxScore) {
      const m = Number(maxScore);
      if (!Number.isFinite(m) || m < 0) errs.maxScore = t('form.errors.maxScoreInvalid');
    }
    if (dueDate && closeDate && closeDate < dueDate) errs.closeDate = t('form.errors.closeBeforeDue');
    // Hạn quá khứ chỉ cấm khi tạo mới; khi sửa được giữ hạn cũ (bài đã quá hạn vẫn lưu được)
    if (!initial && dueDate && dueDate < todayVN()) errs.dueDate = t('form.errors.duePast');
    if (!initial && publishMode === 'schedule' && !publishAt)
      errs.publishAt = t('form.errors.publishAtRequired');
    if (!initial && targetMode === 'selected' && selectedStudents.length === 0)
      errs.students = t('form.errors.studentsRequired');
    if (kind === 'quiz' && quizInvalidCount > 0)
      errs.quiz = t('form.errors.quizInvalid', { count: quizInvalidCount });
    return show(errs);
  };

  const submit = async (publishOverride?: 'now' | 'draft' | 'schedule') => {
    const mode = publishOverride || publishMode;
    if (busy) return;
    if (!validate()) return;
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
        if (kind === 'quiz') await homeworkApi.saveQuiz(initial.id, cleanedQuestions);
        toast(t('form.toast.updated'), 'success');
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
          questions: kind === 'quiz' ? cleanedQuestions : [],
        });
        toast(
          status === 'draft'
            ? t('form.toast.savedDraft')
            : status === 'scheduled'
              ? t('form.toast.scheduled', { count: res.count })
              : t('form.toast.assigned', { count: res.count }),
          'success'
        );
      }
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('form.toast.saveFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const quickDueOptions = [
    { k: 'today', label: t('form.dueToday') },
    { k: 'tomorrow', label: t('form.dueTomorrow') },
    { k: 'weekend', label: t('form.dueWeekend') },
    { k: 'nextweek', label: t('form.dueNextWeek') },
  ] as const;

  return (
    <Modal title={initial ? t('form.titleEdit') : t('form.titleNew')} onClose={onClose} wide>
      {/* Loại bài tập */}
      {!initial && (
        <div className="kind-switcher">
          <button
            type="button"
            className={`kind-btn ${kind === 'homework' ? 'kind-active' : ''}`}
            onClick={() => setKind('homework')}
          >
            <Icon name="clipboard" size={17} /> {t('form.kindHomework')}
          </button>
          <button
            type="button"
            className={`kind-btn ${kind === 'quiz' ? 'kind-active' : ''}`}
            onClick={() => setKind('quiz')}
          >
            <Icon name="check-circle" size={17} /> {t('form.kindQuiz')}
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Chọn lớp */}
        {!initial && (
          <Field label={t('form.selectClass', { count: selectedClasses.length })} error={errors.classes}>
            <input
              ref={refFor('classes')}
              className="text-input hw-mb-8"
              placeholder={t('form.searchClass')}
              value={classSearch}
              onChange={(e) => setClassSearch(e.target.value)}
            />
            <div className="chip-grid">
              {filteredClasses.map((c) => {
                const active = selectedClasses.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${active ? 'chip-active' : ''}`}
                    onClick={() => toggleClass(c.id)}
                  >
                    {active && <Icon name="check" size={12} />}
                    {c.name}
                  </button>
                );
              })}
            </div>
            <div className="hw-flex hw-mt-8">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelectedClasses(classes.map((c) => c.id))}
              >
                {t('form.selectAll')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelectedClasses([])}>
                {t('form.deselectAll')}
              </button>
            </div>
          </Field>
        )}

        {/* Đối tượng */}
        {!initial && (
          <Field label={t('form.assignTo')} error={errors.students}>
            <div className="hw-flex hw-mb-8">
              <button
                type="button"
                className={`btn btn-sm ${targetMode === 'all' ? 'btn-primary' : ''}`}
                onClick={() => setTargetMode('all')}
              >
                {t('form.wholeClass')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${targetMode === 'selected' ? 'btn-primary' : ''}`}
                onClick={() => setTargetMode('selected')}
              >
                {t('form.pickStudents')}
              </button>
            </div>
            {targetMode === 'selected' && (
              <>
                <input
                  ref={refFor('students')}
                  className="text-input hw-mb-8"
                  placeholder={t('form.searchStudent')}
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <div className="chip-grid">
                  {filteredStudents.map((s) => {
                    const active = selectedStudents.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`chip ${active ? 'chip-active' : ''}`}
                        onClick={() => toggleStudent(s.id)}
                      >
                        {active && <Icon name="check" size={12} />}
                        {s.name}
                      </button>
                    );
                  })}
                  {filteredStudents.length === 0 && <span className="muted">{t('form.noResults')}</span>}
                </div>
                <div className="muted hw-text-13 hw-mt-4">
                  {t('form.selectedCount', { count: selectedStudents.length })}
                </div>
              </>
            )}
          </Field>
        )}

        {/* Mẫu nhanh */}
        {!initial && kind === 'homework' && (
          <Field label={t('form.quickTemplates')}>
            <div className="hw-flex-wrap">
              {templates.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setTitle(tpl.title);
                    setContent(tpl.content);
                  }}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label={t('form.title')} error={errors.title}>
          <input
            ref={refFor('title')}
            className="text-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clear('title');
            }}
            placeholder={kind === 'quiz' ? t('form.titlePhQuiz') : t('form.titlePhHw')}
            maxLength={200}
          />
        </Field>

        {kind === 'homework' && (
          <Field label={t('form.content', { count: content.length })}>
            <RichTextarea
              value={content}
              rows={5}
              onChange={(v) => setContent(v.slice(0, 5000))}
              placeholder={t('form.contentPh')}
            />
          </Field>
        )}

        {/* Điểm + Hạn */}
        <div className="form-grid">
          <Field label={t('form.maxScore')} error={errors.maxScore}>
            <input
              ref={refFor('maxScore')}
              className="text-input"
              type="number"
              min="0"
              step="0.5"
              value={maxScore}
              onChange={(e) => {
                setMaxScore(e.target.value);
                clear('maxScore');
              }}
              placeholder={t('form.maxScorePh')}
            />
          </Field>
          <Field label={t('form.dueDate')} error={errors.dueDate}>
            <input
              ref={refFor('dueDate')}
              className="text-input"
              type="date"
              value={dueDate}
              min={initial ? undefined : todayVN()}
              onChange={(e) => {
                setDueDate(e.target.value);
                clear('dueDate');
              }}
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field label={t('form.quickDue')}>
            <div className="hw-flex-6-wrap">
              {quickDueOptions.map(({ k, label }) => (
                <button
                  key={k}
                  type="button"
                  className={`btn btn-sm ${dueDate === quickDate(k) ? 'btn-primary' : ''}`}
                  onClick={() => setDueDate(quickDate(k))}
                >
                  {label}
                </button>
              ))}
              {dueDate && (
                <button type="button" className="btn btn-sm" onClick={() => setDueDate('')}>
                  {t('actions.delete', { ns: 'common' })}
                </button>
              )}
            </div>
          </Field>
          <Field label={t('form.hardDeadline')} error={errors.closeDate}>
            <input
              ref={refFor('closeDate')}
              className="text-input"
              type="date"
              value={closeDate}
              min={initial ? undefined : dueDate || todayVN()}
              onChange={(e) => {
                setCloseDate(e.target.value);
                clear('closeDate');
              }}
            />
            <div className="muted hw-text-12">{t('form.hardDeadlineHint')}</div>
          </Field>
        </div>

        {/* Đính kèm */}
        {kind === 'homework' && (
          <Field label={t('form.attachments')}>
            {attachments.map((a, i) => (
              <div key={i} className="att-row">
                <Icon name="paperclip" size={14} />
                <span>{a.name}</span>
                <span className="muted hw-text-12">{a.url.slice(0, 40)}...</span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-ghost"
                  onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}
                >
                  {t('actions.delete', { ns: 'common' })}
                </button>
              </div>
            ))}
            <div className="hw-flex">
              <input
                className="text-input"
                placeholder={t('form.attNamePh')}
                value={attName}
                onChange={(e) => setAttName(e.target.value)}
              />
              <input
                className="text-input"
                placeholder={t('form.attUrlPh')}
                value={attUrl}
                onChange={(e) => setAttUrl(e.target.value)}
              />
              <button type="button" className="btn" onClick={addAttachment}>
                {t('form.addAttachment')}
              </button>
            </div>
          </Field>
        )}

        {/* Rubric */}
        {kind === 'homework' && (
          <Field label={t('form.rubric')}>
            <div className="hw-flex hw-mb-8">
              <select
                className="text-input hw-flex-1"
                value={rubricId}
                onChange={(e) => setRubricId(e.target.value)}
              >
                <option value="">{t('form.noRubric')}</option>
                {rubrics.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t('form.rubricOption', { name: r.name, score: r.total_score })}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => setShowRubricForm((s) => !s)}>
                {t('form.newRubric')}
              </button>
            </div>
            {selectedRubric && (
              <div className="rubric-preview">
                {selectedRubric.criteria.map((c) => (
                  <div key={c.id} className="rubric-row">
                    <span>{c.name}</span>
                    <span className="num">{t('form.criterionScore', { score: c.max_score })}</span>
                  </div>
                ))}
              </div>
            )}
            {showRubricForm && (
              <div className="rubric-form">
                <input
                  ref={refFor('rubricName')}
                  className="text-input hw-mb-8"
                  placeholder={t('form.rubricNamePh')}
                  value={newRubricName}
                  onChange={(e) => {
                    setNewRubricName(e.target.value);
                    clear('rubricName');
                  }}
                  aria-invalid={errors.rubricName ? true : undefined}
                />
                {errors.rubricName && (
                  <span className="field-error" role="alert">
                    {errors.rubricName}
                  </span>
                )}
                {newCriteria.map((c, i) => (
                  <div key={i} className="hw-flex hw-mb-8">
                    <input
                      ref={i === 0 ? refFor('rubricCriteria') : undefined}
                      className="text-input"
                      placeholder={t('form.criterion')}
                      value={c.name}
                      onChange={(e) => {
                        setNewCriteria((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)));
                        clear('rubricCriteria');
                      }}
                      aria-invalid={errors.rubricCriteria ? true : undefined}
                    />
                    <input
                      className="text-input hw-w-100"
                      type="number"
                      min="0"
                      placeholder={t('form.points')}
                      value={c.max_score}
                      onChange={(e) =>
                        setNewCriteria((x) =>
                          x.map((y, j) => (j === i ? { ...y, max_score: e.target.value } : y))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-ghost"
                      onClick={() => setNewCriteria((x) => x.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {errors.rubricCriteria && (
                  <span className="field-error" role="alert">
                    {errors.rubricCriteria}
                  </span>
                )}
                <div className="hw-flex">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setNewCriteria((x) => [...x, { name: '', max_score: '10' }])}
                  >
                    {t('form.addCriterion')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={rubricBusy}
                    onClick={createRubricNow}
                  >
                    {rubricBusy && <span className="spinner" aria-hidden="true" />}
                    {rubricBusy ? t('actions.saving', { ns: 'common' }) : t('form.saveRubric')}
                  </button>
                </div>
              </div>
            )}
          </Field>
        )}

        {/* Quiz builder */}
        {kind === 'quiz' && (
          <div ref={refFor('quiz')} tabIndex={-1}>
            <Field
              label={t('form.quizQuestions', { count: questions.length, total: quizTotal })}
              error={errors.quiz}
            >
            {quizLocked && (
              <div className="alert alert-warning alert-with-icon hw-mb-12">
                <Icon name="alert" size={16} />
                <span>{t('form.quizLocked')}</span>
              </div>
            )}
            {questions.map((q, qi) => {
              const qtype = q.qtype ?? 'single';
              return (
              <div key={qi} className="quiz-q">
                <div className="hw-flex hw-mb-8">
                  <span className="quiz-num">{qi + 1}</span>
                  <input
                    className="text-input hw-flex-1"
                    placeholder={t('form.questionPh', { n: qi + 1 })}
                    value={q.question}
                    disabled={quizLocked}
                    onChange={(e) => updateQuestion(qi, { question: e.target.value })}
                  />
                  {questions.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-ghost"
                      disabled={quizLocked}
                      onClick={() => setQuestions((x) => x.filter((_, j) => j !== qi))}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="hw-flex-wrap hw-mb-8">
                  <select
                    className="text-input"
                    aria-label={t('bank.qtype')}
                    value={qtype}
                    disabled={quizLocked}
                    onChange={(e) => changeQuestionType(qi, e.target.value as QType)}
                  >
                    <option value="single">{t('bank.qtypeSingle')}</option>
                    <option value="multiple">{t('bank.qtypeMultiple')}</option>
                    <option value="truefalse">{t('bank.qtypeTruefalse')}</option>
                    <option value="essay">{t('bank.qtypeEssay')}</option>
                  </select>
                  <input
                    className="text-input hw-w-80"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={q.points}
                    disabled={quizLocked}
                    onChange={(e) => updateQuestion(qi, { points: Number(e.target.value) || 1 })}
                    title={t('form.points')}
                    aria-label={t('form.points')}
                  />
                </div>
                {qtype === 'essay' ? (
                  <p className="muted-sm hw-mb-8">{t('bank.essayHint')}</p>
                ) : (
                  <>
                    {qtype === 'multiple' && <p className="muted-sm">{t('bank.answersMultiple')}</p>}
                    {q.options.map((o, oi) => (
                      <div key={oi} className="quiz-opt">
                        <button
                          type="button"
                          className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
                          disabled={quizLocked}
                          onClick={() =>
                            updateOption(qi, oi, { is_correct: qtype === 'multiple' ? !o.is_correct : true })
                          }
                          title={t('form.correctAnswer')}
                          aria-pressed={o.is_correct}
                        >
                          {qtype === 'multiple' ? (o.is_correct ? '☑' : '☐') : o.is_correct ? '●' : '○'}
                        </button>
                        <input
                          className="text-input input-sm hw-flex-1"
                          placeholder={t('form.optionPh', { letter: String.fromCharCode(65 + oi) })}
                          value={o.text}
                          disabled={quizLocked || qtype === 'truefalse'}
                          onChange={(e) => updateOption(qi, oi, { text: e.target.value })}
                        />
                        {qtype !== 'truefalse' && q.options.length > 2 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger-ghost"
                            disabled={quizLocked}
                            onClick={() => removeOption(qi, oi)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {qtype !== 'truefalse' && (
                      <button
                        type="button"
                        className="btn btn-sm hw-mt-4"
                        disabled={quizLocked}
                        onClick={() => addOption(qi)}
                      >
                        {t('form.addOption')}
                      </button>
                    )}
                  </>
                )}
              </div>
              );
            })}
            <div className="hw-flex">
              <button type="button" className="btn" disabled={quizLocked} onClick={addQuestion}>
                {t('form.addQuestion')}
              </button>
              <button
                type="button"
                className="btn hw-action-icon"
                disabled={quizLocked}
                onClick={() => setShowBankPicker(true)}
              >
                <Icon name="book" size={15} /> {t('form.fromBank')}
              </button>
            </div>
            </Field>
          </div>
        )}

        {/* Xuất bản */}
        {!initial && (
          <Field label={t('form.publishSection')} error={errors.publishAt}>
            <div className="publish-options">
              {(
                [
                  ['now', t('form.publishNowOpt')],
                  ['schedule', t('form.publishScheduleOpt')],
                  ['draft', t('form.publishDraftOpt')],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  className={`publish-btn ${publishMode === m ? 'active' : ''}`}
                  onClick={() => setPublishMode(m)}
                >
                  {label}
                </button>
              ))}
            </div>
            {publishMode === 'schedule' && (
              <input
                ref={refFor('publishAt')}
                className="text-input hw-mt-8"
                type="datetime-local"
                value={publishAt}
                min={nowVN()}
                onChange={(e) => {
                  setPublishAt(e.target.value);
                  clear('publishAt');
                }}
              />
            )}
          </Field>
        )}

        {/* Preview */}
        {showPreview && (
          <div className="preview-box">
            <div className="preview-label">{t('form.preview')}</div>
            <div className="card hw-flat-card">
              <div className="card-head">
                <h2>{title || t('form.noTitle')}</h2>
                {dueDate && (
                  <span className="badge badge-upcoming">
                    {t('form.dueWithDate', { date: formatDate(dueDate) })}
                  </span>
                )}
              </div>
              {content && <p className="homework-content">{content}</p>}
              {maxScore && <p className="muted">{t('table.maxScore', { max: maxScore })}</p>}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? t('form.hidePreview') : t('form.preview')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          {initial ? (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? t('actions.saving', { ns: 'common' }) : t('form.saveChanges')}
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void submit('draft')}>
                {busy && <span className="spinner spinner-dark" aria-hidden="true" />}
                {t('form.saveDraft')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy
                  ? t('form.submitting')
                  : publishMode === 'schedule'
                    ? t('form.scheduleFor', { count: selectedClasses.length })
                    : t('form.publishFor', { count: selectedClasses.length })}
              </button>
            </>
          )}
        </div>
      </form>
      {showBankPicker && (
        <QuestionBank onClose={() => setShowBankPicker(false)} selectMode onImport={importBankQuestions} />
      )}
    </Modal>
  );
}
