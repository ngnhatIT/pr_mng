import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useResolvedPath } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { homeworkApi } from './homework.api';
import { ClassItem } from '../classes/classes.api';
import { HomeworkItem, formatDate, todayVN, nowVN } from '../../shared/types';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { RichTextarea } from '../../shared/components/RichTextarea';
import { LoadError } from '../../shared/components/EmptyState';
import { useUnsavedGuard } from '../../shared/hooks/useUnsavedGuard';
import { useGoBack } from '../../shared/hooks/useGoBack';
import { useLoad } from '../../shared/hooks/useLoad';
import './Homework.css';
import { QuestionBank } from './QuestionBank';
import { DEFAULT_MAX_ATTEMPTS, type HwErrKey } from './homeworkForm';
import { DeadlineFields } from './DeadlineFields';
import { QuizBuilder, useQuizBuilder } from './QuizBuilder';
import { AttachmentsField, useAttachments } from './AttachmentsField';
import { RubricField, useRubric } from './RubricField';
import { ClassTargeting, useClassTargeting } from './ClassTargeting';

// Hàm thuần tách sang homeworkForm.ts; re-export để import cũ (test, nơi khác) vẫn chạy.
export {
  isValidHttpUrl,
  isQuizQuestionInvalid,
  quickDate,
  validateLocalUpload,
  pruneSelected,
  editAttachmentsPayload,
} from './homeworkForm';

/**
 * Trang soạn bài: /app/homework/new, /app/homework/:id/edit (giáo viên: /teacher/bai-tap/...).
 * Tạo mới cần danh sách lớp; sửa cần tải bài theo id. Hủy/lưu xong quay về danh sách (giữ bộ lọc nhờ history).
 */
export function HomeworkEditor() {
  const { t } = useTranslation(['homework', 'common']);
  const { id } = useParams();
  const listPath = useResolvedPath(id ? '../..' : '..', { relative: 'path' }).pathname;
  const goBack = useGoBack(listPath);
  const { data, error, reload } = useLoad(
    async () =>
      id
        ? { classes: [] as ClassItem[], initial: await homeworkApi.get(Number(id)) }
        : {
            classes: (await homeworkApi.listClasses()).filter((c) => c.status === 'active'),
            initial: null,
          },
    [id]
  );

  return (
    <div className="page hw-editor-page">
      <button type="button" className="link back-link" onClick={goBack}>
        <Icon name="arrow-left" size={14} />
        {t('page.title')}
      </button>
      <div className="page-head">
        <div>
          <h1 className="page-title">{id ? t('form.titleEdit') : t('form.titleNew')}</h1>
          {data?.initial && <p className="page-sub">{data.initial.class_name}</p>}
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <div className="route-loader" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
        </div>
      ) : (
        <HomeworkForm classes={data.classes} initial={data.initial} onCancel={goBack} onSaved={goBack} />
      )}
    </div>
  );
}

/**
 * Form tạo/sửa bài tập + quiz. Các phần lớn tách file riêng (state vẫn ở đây qua hook, truyền props xuống):
 * ClassTargeting (lớp + đối tượng), AttachmentsField, RubricField, QuizBuilder.
 * Bố cục trang: cột chính (nội dung, đề quiz) + cột phụ (lớp, hạn nộp, đăng bài), thanh lưu dính đáy.
 */
export function HomeworkForm({
  classes,
  initial,
  onCancel,
  onSaved,
}: {
  classes: ClassItem[];
  initial: HomeworkItem | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2).
  // Nút submit KHÔNG disable khi thiếu dữ liệu: bấm sẽ hiện lỗi inline thay vì im lặng.
  const fe = useFieldErrors<HwErrKey>();
  const { errors, refFor, show, clear } = fe;
  const [kind, setKind] = useState<'homework' | 'quiz'>(initial?.kind || 'homework');
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [dueDate, setDueDate] = useState(initial?.due_date?.slice(0, 10) || '');
  const [closeDate, setCloseDate] = useState(initial?.close_date?.slice(0, 10) || '');
  const [maxScore, setMaxScore] = useState(initial?.max_score?.toString() || '');
  // C-1: quiz mới mặc định 3 lượt (mỗi lượt lộ tổng điểm -> không giới hạn = dò được đáp án); '' = không giới hạn
  const initialMaxAttempts = initial ? (initial.max_attempts?.toString() ?? '') : DEFAULT_MAX_ATTEMPTS;
  const [maxAttempts, setMaxAttempts] = useState(initialMaxAttempts);
  const maxAttemptsPayload = maxAttempts ? Number(maxAttempts) : null;
  // Thứ tự hook giữ đúng thứ tự effect cũ: đề quiz -> đính kèm -> rubric -> học viên
  const quiz = useQuizBuilder(initial, clear);
  const att = useAttachments(initial, fe);
  const rubric = useRubric(initial, fe);
  const ct = useClassTargeting(initial, clear);
  const { selectedClasses, selectedStudents, targetMode, studentsLoading, pickedStudents } = ct;
  const { questions, quizEdited, builderLocked, quizTotal, quizInvalidCount, cleanedQuestions } = quiz;
  const { attachments, attLoad, attDirty, attName, attUrl } = att;
  const { rubricId, newRubricName } = rubric;
  const templates = t('form.templates', { returnObjects: true }) as {
    name: string;
    title: string;
    content: string;
  }[];
  // Xuất bản
  const [publishMode, setPublishMode] = useState<'now' | 'draft' | 'schedule'>('now');
  const [publishAt, setPublishAt] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sửa quiz: chỉ lưu đề khi đã sửa đề và đề không bị khóa (có lượt làm / tải lỗi) — server chặn sửa đề đã có lượt làm
  const willSaveQuiz = kind === 'quiz' && (!initial || (quizEdited && !builderLocked));

  const validate = () => {
    // P1-1: thứ tự insert errs khớp thứ tự field trên form để focus field lỗi đầu tiên đúng.
    const errs: Partial<Record<HwErrKey, string>> = {};
    if (!initial && selectedClasses.length === 0) errs.classes = t('form.errors.classRequired');
    if (!initial && targetMode === 'selected') {
      if (studentsLoading) errs.students = t('form.loadingStudents');
      else if (pickedStudents.length === 0) errs.students = t('form.errors.studentsRequired');
    }
    if (!title.trim()) errs.title = t('form.errors.titleRequired');
    if (kind === 'homework' && maxScore) {
      const m = Number(maxScore);
      if (!Number.isFinite(m) || m < 0) errs.maxScore = t('form.errors.maxScoreInvalid');
    }
    // Hạn quá khứ chỉ cấm khi tạo mới; khi sửa được giữ hạn cũ (bài đã quá hạn vẫn lưu được)
    if (!initial && dueDate && dueDate < todayVN()) errs.dueDate = t('form.errors.duePast');
    if (dueDate && closeDate && closeDate < dueDate) errs.closeDate = t('form.errors.closeBeforeDue');
    if (kind === 'quiz' && maxAttempts) {
      const n = Number(maxAttempts);
      if (!Number.isInteger(n) || n < 1 || n > 100) errs.maxAttempts = t('form.errors.maxAttemptsInvalid');
    }
    if (willSaveQuiz && quizInvalidCount > 0)
      errs.quiz = t('form.errors.quizInvalid', { count: quizInvalidCount });
    if (!initial && publishMode === 'schedule' && !publishAt)
      errs.publishAt = t('form.errors.publishAtRequired');
    // B4-1: link gõ dở mà thiếu/sai URL -> chặn lưu (hợp lệ thì submit tự thêm, không âm thầm bỏ)
    const attErr = att.pendingError();
    if (attErr) errs.attachment = attErr;
    const ok = show(errs);
    const first = (Object.keys(errs) as HwErrKey[])[0];
    // P1-2: lỗi quiz là lỗi đầu tiên → cuộn + focus tới câu hỏi lỗi đầu tiên (pattern QuizTaker)
    if (first === 'quiz') quiz.focusFirstInvalid();
    if (first === 'attachment') att.attUrlRef.current?.focus();
    return ok;
  };

  const submit = async (publishOverride?: 'now' | 'draft' | 'schedule') => {
    const mode = publishOverride || publishMode;
    if (busy) return;
    if (!validate()) return;
    const attList = att.commitPending();
    setBusy(true);
    try {
      const status = mode === 'now' ? 'published' : mode === 'draft' ? 'draft' : 'scheduled';
      if (initial) {
        await homeworkApi.update(initial.id, {
          title: title.trim(),
          content: content.trim() || null,
          due_date: dueDate || null,
          max_score: kind === 'quiz' ? quizTotal || null : maxScore ? Number(maxScore) : null,
          close_date: closeDate || null,
          rubric_id: rubricId ? Number(rubricId) : null,
          ...(kind === 'quiz' ? { max_attempts: maxAttemptsPayload } : {}),
          // Giữ trạng thái xuất bản hiện tại: sửa bài nháp/hẹn giờ không được tự đăng ngay
          status: initial.status,
          publish_at: initial.publish_at ?? null,
          // YC1: đồng bộ đính kèm khi sửa (thêm/xóa); chưa tải xong/lỗi → undefined = server giữ nguyên
          attachments: att.editPayload(attList),
        });
        // Đính kèm đã gắn vào bài → không còn mồ côi (Hủy sau lỗi lưu đề không được xóa file)
        att.markSaved();
        if (willSaveQuiz) await homeworkApi.saveQuiz(initial.id, cleanedQuestions);
        toast(t('form.toast.updated'), 'success');
      } else {
        const res = await homeworkApi.create({
          class_ids: selectedClasses,
          title: title.trim(),
          content: content.trim() || null,
          due_date: dueDate || null,
          status,
          publish_at: status === 'scheduled' ? publishAt : null,
          max_score: kind === 'quiz' ? quizTotal || null : maxScore ? Number(maxScore) : null,
          close_date: closeDate || null,
          kind,
          rubric_id: rubricId ? Number(rubricId) : null,
          max_attempts: kind === 'quiz' ? maxAttemptsPayload : null,
          attachments: attList,
          target_student_ids: targetMode === 'selected' ? pickedStudents : [],
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
      // Lưu thành công → file đã gắn vào bài, không còn mồ côi; tắt guard trước khi rời trang
      att.markSaved();
      flushSync(() => setSaved(true));
      onSaved();
    } catch (err) {
      toastApiError(toast, err, t('form.toast.saveFail'));
    } finally {
      setBusy(false);
    }
  };

  // P0-1: phát hiện dữ liệu đã nhập/sửa để hỏi xác nhận khi đóng modal (chống mất dữ liệu).
  // Chế độ sửa: so với giá trị ban đầu; chế độ tạo: so với form trống.
  const isDirty = useMemo(() => {
    if (initial) {
      return (
        title !== (initial.title || '') ||
        content !== (initial.content || '') ||
        dueDate !== (initial.due_date?.slice(0, 10) || '') ||
        closeDate !== (initial.close_date?.slice(0, 10) || '') ||
        maxScore !== (initial.max_score?.toString() || '') ||
        maxAttempts !== initialMaxAttempts ||
        rubricId !== (initial.rubric_id?.toString() || '') ||
        attDirty ||
        attName.trim() !== '' ||
        attUrl.trim() !== '' ||
        quizEdited
      );
    }
    return (
      kind !== 'homework' ||
      title.trim() !== '' ||
      content.trim() !== '' ||
      dueDate !== '' ||
      closeDate !== '' ||
      maxScore !== '' ||
      maxAttempts !== initialMaxAttempts ||
      selectedClasses.length > 0 ||
      selectedStudents.length > 0 ||
      attachments.length > 0 ||
      attName.trim() !== '' ||
      attUrl.trim() !== '' ||
      rubricId !== '' ||
      newRubricName.trim() !== '' ||
      publishMode !== 'now' ||
      publishAt !== '' ||
      quizEdited ||
      questions.length > 1 ||
      (questions[0]?.question.trim() ?? '') !== ''
    );
  }, [
    initial,
    kind,
    title,
    content,
    dueDate,
    closeDate,
    maxScore,
    maxAttempts,
    initialMaxAttempts,
    selectedClasses,
    selectedStudents,
    attachments,
    attName,
    attUrl,
    rubricId,
    newRubricName,
    publishMode,
    publishAt,
    questions,
    quizEdited,
    attDirty,
  ]);
  const [saved, setSaved] = useState(false);
  // Rời trang khi đang soạn dở: blocker chung của app hỏi xác nhận (Hủy, Back, bấm menu); reload/đóng tab: beforeunload
  useUnsavedGuard(isDirty && !saved);
  // Rời trang (đã xác nhận bỏ) -> xóa file đã upload mà chưa gắn vào bài; lưu xong thì markSaved đã dọn danh sách
  const { cleanupOrphans } = att;
  useEffect(() => cleanupOrphans, [cleanupOrphans]);

  const submitLabel = busy
    ? t('form.submitting')
    : publishMode === 'schedule'
      ? selectedClasses.length === 0
        ? t('form.selectClassToSchedule')
        : t('form.scheduleFor', { count: selectedClasses.length })
      : selectedClasses.length === 0
        ? t('form.selectClassToPublish')
        : t('form.publishFor', { count: selectedClasses.length });

  return (
    <>
      <form
        className={`hw-editor${initial ? ' is-edit' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="hw-editor-main">
          <section className="card">
            {/* Loại bài tập */}
            {!initial && (
              <div className="kind-switcher">
                <button
                  type="button"
                  className={`kind-btn ${kind === 'homework' ? 'kind-active' : ''}`}
                  aria-pressed={kind === 'homework'}
                  onClick={() => setKind('homework')}
                >
                  <Icon name="clipboard" size={17} /> {t('form.kindHomework')}
                </button>
                <button
                  type="button"
                  className={`kind-btn ${kind === 'quiz' ? 'kind-active' : ''}`}
                  aria-pressed={kind === 'quiz'}
                  onClick={() => setKind('quiz')}
                >
                  <Icon name="check-circle" size={17} /> {t('form.kindQuiz')}
                </button>
              </div>
            )}

            {/* Mẫu nhanh */}
            {!initial && kind === 'homework' && (
              <Field label={t('form.quickTemplates')} group>
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
                  rows={10}
                  onChange={(v) => setContent(v.slice(0, 5000))}
                  placeholder={t('form.contentPh')}
                />
              </Field>
            )}

            {/* Đính kèm: cả bài thường lẫn quiz, cả chế độ tạo và sửa (updateHomework đã đồng bộ). */}
            <AttachmentsField att={att} error={errors.attachment} busy={busy} />
          </section>

          {/* Quiz builder */}
          {kind === 'quiz' && (
            <section className="card" ref={refFor('quiz')} tabIndex={-1}>
              <QuizBuilder quiz={quiz} error={errors.quiz} />
            </section>
          )}

          {/* Preview */}
          {showPreview && (
            <section className="card preview-box">
              <div className="preview-label">{t('form.preview')}</div>
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
            </section>
          )}
        </div>

        {/* Chọn lớp + đối tượng */}
        {!initial && (
          <section className="card hw-editor-target">
            <h2 className="hw-editor-heading">{t('form.sectionTarget')}</h2>
            <ClassTargeting ct={ct} classes={classes} fe={fe} />
          </section>
        )}

        <div className="hw-editor-side">
          <section className="card">
            <h2 className="hw-editor-heading">{t('form.sectionGrading')}</h2>
            <DeadlineFields
              isQuiz={kind === 'quiz'}
              isEdit={!!initial}
              quizTotal={quizTotal}
              maxScore={maxScore}
              setMaxScore={setMaxScore}
              dueDate={dueDate}
              setDueDate={setDueDate}
              closeDate={closeDate}
              setCloseDate={setCloseDate}
              fe={fe}
            />
            {kind === 'quiz' && (
              <Field
                label={t('form.maxAttempts')}
                hint={t('form.maxAttemptsHint')}
                error={errors.maxAttempts}
              >
                <input
                  ref={refFor('maxAttempts')}
                  className="text-input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  step="1"
                  value={maxAttempts}
                  onChange={(e) => {
                    setMaxAttempts(e.target.value);
                    clear('maxAttempts');
                  }}
                  placeholder={t('form.maxAttemptsPh')}
                />
              </Field>
            )}
            {/* Rubric — bài thường chấm tay; quiz dùng để chấm các câu tự luận (YC2) */}
            <RubricField r={rubric} fe={fe} isQuiz={kind === 'quiz'} />
          </section>

          {/* Xuất bản */}
          {!initial && (
            <section className="card">
              <Field label={t('form.publishSection')} error={errors.publishAt} group>
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
                      aria-pressed={publishMode === m}
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
                    aria-label={t('form.publishScheduleOpt')}
                    value={publishAt}
                    min={nowVN()}
                    onChange={(e) => {
                      setPublishAt(e.target.value);
                      clear('publishAt');
                    }}
                  />
                )}
              </Field>
            </section>
          )}
        </div>

        <div className="hw-editor-bar">
          <button type="button" className="btn" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? t('form.hidePreview') : t('form.preview')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          {initial ? (
            <button type="submit" className="btn btn-primary" disabled={busy || attLoad === 'loading'}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? t('actions.saving', { ns: 'common' }) : t('form.saveChanges')}
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void submit('draft')}>
                {t('form.saveDraft')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {submitLabel}
              </button>
            </>
          )}
        </div>
      </form>
      {/* Ngoài <form>: nút trong picker không được submit form bài tập */}
      {quiz.showBankPicker && (
        <QuestionBank
          onClose={() => quiz.setShowBankPicker(false)}
          selectMode
          onImport={quiz.importBankQuestions}
        />
      )}
    </>
  );
}
