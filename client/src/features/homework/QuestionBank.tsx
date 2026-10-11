import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, blankOptions, type BankQuestion, type QType } from './homework.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { useDebounce } from '../../shared/hooks/useDebounce';

type Difficulty = 'easy' | 'medium' | 'hard';

/** Nhãn loại câu hỏi (dùng chung list + form). */
function QTypeBadge({ qtype }: { qtype: QType }) {
  const { t } = useTranslation('homework');
  const labels: Record<QType, string> = {
    single: t('bank.qtypeSingle'),
    multiple: t('bank.qtypeMultiple'),
    truefalse: t('bank.qtypeTruefalse'),
    essay: t('bank.qtypeEssay'),
  };
  return <span className="badge badge-general">{labels[qtype] ?? qtype}</span>;
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const { t } = useTranslation('homework');
  const cls = difficulty === 'easy' ? 'badge-paid' : difficulty === 'hard' ? 'badge-overdue' : 'badge-late';
  const labels: Record<Difficulty, string> = {
    easy: t('bank.difficultyEasy'),
    medium: t('bank.difficultyMedium'),
    hard: t('bank.difficultyHard'),
  };
  return <span className={`badge ${cls}`}>{labels[difficulty] ?? difficulty}</span>;
}

/** Ngân hàng câu hỏi: quản lý + chọn import vào quiz. */
export function QuestionBank({
  onClose,
  onImport,
  selectMode,
}: {
  onClose: () => void;
  onImport?: (questions: BankQuestion[]) => void;
  selectMode?: boolean;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [subject, setSubject] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const debouncedTag = useDebounce(tag, 300);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  // Phân bổ điểm khi import: giữ điểm gốc hoặc đặt mỗi câu = N điểm
  const [pointsMode, setPointsMode] = useState<'keep' | 'set'>('keep');
  const [pointsEach, setPointsEach] = useState('1');
  // Cache mọi câu hỏi đã thấy để giữ lựa chọn khi đổi filter
  const allSeen = useRef(new Map<number, BankQuestion>());
  // Chống response về sai thứ tự: chỉ request mới nhất được ghi state
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await homeworkApi.bankList(debouncedSearch, debouncedTag, page, 50, subject, difficulty);
      if (seq !== loadSeq.current) return;
      setQuestions(res.data);
      setTags(res.tags);
      setSubjects(res.subjects ?? []);
      setPagination(res.pagination);
      res.data.forEach((q) => allSeen.current.set(q.id, q));
    } catch (err) {
      if (seq === loadSeq.current)
        setLoadError(err instanceof Error ? err.message : t('bank.toast.loadFail'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [debouncedSearch, debouncedTag, page, subject, difficulty, t]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, debouncedTag, subject, difficulty]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteringBank = search.trim() !== '' || tag !== '' || subject !== '' || difficulty !== '';

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Chọn tất cả câu ở trang hiện tại (bỏ chọn nếu đã chọn hết)
  const toggleSelectPage = () => {
    const ids = questions.map((q) => q.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((s) => (allSelected ? s.filter((id) => !ids.includes(id)) : [...new Set([...s, ...ids])]));
  };

  const doDelete = (id: number) => {
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    const id = deletingId;
    setDeletingId(null);
    try {
      await homeworkApi.bankDelete(id);
      toast(t('bank.toast.deleted'), 'success');
      setSelected((s) => s.filter((x) => x !== id));
      allSeen.current.delete(id);
      void load();
    } catch (err) {
      toastApiError(toast, err, t('bank.toast.deleteFail'));
    }
  };

  const pointsEachNum = Number(pointsEach);
  const pointsEachValid = pointsEachNum > 0 && pointsEachNum <= 1000;

  const doImport = () => {
    if (!onImport || !selected.length) return;
    if (pointsMode === 'set' && !pointsEachValid) return;
    // Giữ lựa chọn theo ID độc lập với filter: lấy từ cache tất cả câu đã thấy
    const picked = selected.map((id) => allSeen.current.get(id)).filter((q): q is BankQuestion => !!q);
    if (picked.length < selected.length) {
      toast(t('bank.toast.staleSelection', { count: selected.length - picked.length }), 'error');
      return;
    }
    const withPoints = pointsMode === 'set' ? picked.map((q) => ({ ...q, points: pointsEachNum })) : picked;
    onImport(withPoints);
    onClose();
  };

  const pageIds = questions.map((q) => q.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  return (
    <Modal
      title={t('bank.title')}
      onClose={onClose}
      wide
      // đang mở form câu hỏi hoặc đã chọn câu để import: hỏi trước khi đóng
      dirty={showForm || editing !== null || selected.length > 0}
    >
      <div className="toolbar">
        <div className={`search-wrap${search ? ' has-clear' : ''}`}>
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            aria-label={t('bank.searchPh')}
            placeholder={t('bank.searchPh')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearch('')}
              aria-label={t('bank.clearSearch')}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <select
          aria-label={t('bank.tagFilterLabel')}
          className="text-input"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">{t('bank.allTags')}</option>
          {tags.map((tg) => (
            <option key={tg} value={tg}>
              {tg}
            </option>
          ))}
        </select>
        <select
          aria-label={t('bank.subjectFilterLabel')}
          className="text-input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">{t('bank.allSubjects')}</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label={t('bank.difficultyFilterLabel')}
          className="text-input"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
        >
          <option value="">{t('bank.allDifficulties')}</option>
          <option value="easy">{t('bank.difficultyEasy')}</option>
          <option value="medium">{t('bank.difficultyMedium')}</option>
          <option value="hard">{t('bank.difficultyHard')}</option>
        </select>
        <button
          className="btn btn-primary hw-action-icon"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Icon name="plus" size={15} /> {t('bank.add')}
        </button>
      </div>

      {(showForm || editing) && (
        <BankQuestionForm
          // key: form seed state 1 lần từ initial → đổi câu đang sửa phải remount, tránh lưu nội dung câu cũ vào câu khác
          key={editing ? `edit-${editing.id}` : 'new'}
          tags={tags}
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      {loading ? (
        <p className="muted">{t('actions.loading', { ns: 'common' })}</p>
      ) : loadError ? (
        <EmptyState
          icon="alert"
          title={t('bank.loadErrorTitle')}
          desc={loadError}
          action={
            <button className="btn btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={16} />
              {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      ) : questions.length === 0 ? (
        <EmptyState
          icon="file"
          title={t(filteringBank ? 'bank.emptyFiltered.title' : 'bank.empty')}
          desc={t(filteringBank ? 'bank.emptyFiltered.desc' : 'bank.emptyDesc')}
          action={
            filteringBank ? (
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => {
                  setSearch('');
                  setTag('');
                  setSubject('');
                  setDifficulty('');
                }}
              >
                <Icon name="x" size={14} />
                {t('bank.emptyFiltered.clear')}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-inline"
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Icon name="plus" size={14} />
                {t('bank.add')}
              </button>
            )
          }
        />
      ) : (
        <div className="bank-list">
          {questions.map((q) => (
            <div key={q.id} className="bank-item">
              {selectMode && (
                <input
                  type="checkbox"
                  className="bank-check"
                  aria-label={q.question}
                  checked={selected.includes(q.id)}
                  onChange={() => toggle(q.id)}
                />
              )}
              <div className="bank-item-body">
                <div className="bank-q">{q.question}</div>
                <div className="muted bank-item-meta">
                  <QTypeBadge qtype={q.qtype} />
                  {q.subject && <span className="badge badge-general">{q.subject}</span>}
                  <DifficultyBadge difficulty={q.difficulty} />
                  {q.tag && <span className="badge badge-general bank-tag-badge">{q.tag}</span>}
                  {t('bank.meta', { points: q.points, count: q.options.length })}
                </div>
                <BankOptionsPreview q={q} />
              </div>
              {!selectMode && (
                <span className="bank-item-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setEditing(q);
                      setShowForm(false);
                    }}
                    title={t('bank.edit')}
                  >
                    <Icon name="pencil" size={14} />
                    {t('actions.edit', { ns: 'common' })}
                  </button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => void doDelete(q.id)}>
                    {t('actions.delete', { ns: 'common' })}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}

      {selectMode && (
        <div className="modal-actions bank-select-footer">
          <button
            type="button"
            className="btn btn-sm"
            onClick={toggleSelectPage}
            disabled={!questions.length}
          >
            {pageAllSelected ? t('bank.deselectAllPage') : t('bank.selectAllPage')}
          </button>
          <span className="muted">{t('bank.selected', { count: selected.length })}</span>
          <span className="bank-points-mode" role="radiogroup" aria-label={t('bank.pointsEachPh')}>
            <label className="bank-points-opt">
              <input
                type="radio"
                name="bank-points-mode"
                checked={pointsMode === 'keep'}
                onChange={() => setPointsMode('keep')}
              />
              {t('bank.pointsModeKeep')}
            </label>
            <label className="bank-points-opt">
              <input
                type="radio"
                name="bank-points-mode"
                checked={pointsMode === 'set'}
                onChange={() => setPointsMode('set')}
              />
              {t('bank.pointsModeSet')}
            </label>
            {pointsMode === 'set' && (
              <input
                type="number"
                className="text-input input-sm bank-points-input"
                aria-label={t('bank.pointsEachPh')}
                min="0.5"
                step="0.5"
                value={pointsEach}
                onChange={(e) => setPointsEach(e.target.value)}
                aria-invalid={!pointsEachValid}
              />
            )}
          </span>
          {pointsMode === 'set' && !pointsEachValid && (
            <span className="field-error" role="alert">
              {t('bank.pointsInvalid')}
            </span>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button
            className="btn btn-primary hw-action-icon"
            disabled={!selected.length || (pointsMode === 'set' && !pointsEachValid)}
            onClick={doImport}
          >
            <Icon name="plus" size={15} /> {t('bank.import', { count: selected.length })}
          </button>
        </div>
      )}
      {deletingId !== null && (
        <ConfirmDialog
          title={t('bank.deleteTitle')}
          message={t('bank.deleteConfirm')}
          onClose={() => setDeletingId(null)}
          onConfirm={confirmDelete}
          danger
        />
      )}
    </Modal>
  );
}

/** Xem trước đầy đủ đáp án ngay ở list item, đánh dấu TẤT CẢ đáp án đúng. */
function BankOptionsPreview({ q }: { q: BankQuestion }) {
  const { t } = useTranslation('homework');
  if (q.qtype === 'essay') {
    return <div className="muted bank-item-meta">{t('bank.essayHint')}</div>;
  }
  return (
    <ul className="bank-opts-preview" aria-label={t('bank.correctAnswers')}>
      {q.options.map((o, i) => (
        <li key={o.id} className={o.is_correct ? 'is-correct' : undefined}>
          <span className="bank-opt-letter">{String.fromCharCode(65 + i)}.</span> {o.text}
          {o.is_correct && (
            <span className="bank-opt-correct" aria-label={t('bank.correctAnswers')}>
              <Icon name="check" size={13} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function BankQuestionForm({
  tags,
  initial,
  onClose,
  onSaved,
}: {
  tags: string[];
  /** Sửa: prefill từ câu hỏi có sẵn; null/undefined = thêm mới. */
  initial?: BankQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [qtype, setQtype] = useState<QType>(initial?.qtype ?? 'single');
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [tag, setTag] = useState(initial?.tag ?? '');
  const [newTag, setNewTag] = useState('');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'medium');
  const [points, setPoints] = useState(String(initial?.points ?? 1));
  const [options, setOptions] = useState(
    initial && initial.qtype !== 'essay'
      ? initial.options.map((o) => ({ text: o.text, is_correct: o.is_correct }))
      : blankOptions()
  );
  const [busy, setBusy] = useState(false);
  // Lỗi inline dưới field (skill 8.2), focus vào field lỗi đầu tiên
  const { errors, refFor, show, clear } = useFieldErrors<'question' | 'points' | 'answers'>();

  const changeQtype = (next: QType) => {
    setQtype(next);
    clear('answers');
    // Câu Đúng/Sai: tạo sẵn 2 đáp án, giáo viên chỉ chọn đáp án đúng
    if (next === 'truefalse') {
      setOptions([
        { text: t('bank.trueLabel'), is_correct: true },
        { text: t('bank.falseLabel'), is_correct: false },
      ]);
    } else if (options.length === 0) {
      setOptions(blankOptions());
    }
  };

  const toggleCorrect = (i: number) => {
    if (qtype === 'single' || qtype === 'truefalse') {
      // 1 đáp án đúng: chọn đáp án này, bỏ chọn các đáp án khác
      setOptions((x) => x.map((y, j) => ({ ...y, is_correct: j === i })));
    } else {
      // nhiều đáp án đúng: bật/tắt từng đáp án
      setOptions((x) => x.map((y, j) => (j === i ? { ...y, is_correct: !y.is_correct } : y)));
    }
    clear('answers');
  };

  const save = async () => {
    if (busy) return;
    const errs: { question?: string; points?: string; answers?: string } = {};
    if (!question.trim()) errs.question = t('bank.form.questionRequired');
    const pointsNum = Number(points);
    if (!Number.isFinite(pointsNum) || pointsNum <= 0 || pointsNum > 1000)
      errs.points = t('bank.pointsInvalid');
    // Lọc đáp án trống trước khi validate/gửi (không gửi đáp án trống lên server)
    const filled = options
      .map((o) => ({ text: o.text.trim(), is_correct: o.is_correct }))
      .filter((o) => o.text);
    if (qtype !== 'essay') {
      if (qtype === 'truefalse') {
        if (filled.length !== 2 || filled.filter((o) => o.is_correct).length !== 1)
          errs.answers = t('bank.answersRequiredTruefalse');
      } else if (filled.length < 2) {
        errs.answers = t('bank.form.answersRequired');
      } else if (qtype === 'single' && filled.filter((o) => o.is_correct).length !== 1) {
        errs.answers = t('bank.form.answersRequired');
      } else if (qtype === 'multiple' && !filled.some((o) => o.is_correct)) {
        errs.answers = t('bank.answersRequiredMultiple');
      }
    }
    if (!show(errs)) return;
    setBusy(true);
    try {
      const payload = {
        tag: newTag.trim() || tag || null,
        subject: subject.trim() || null,
        difficulty,
        qtype,
        question: question.trim(),
        points: pointsNum,
        options: qtype === 'essay' ? [] : filled,
      };
      if (initial) {
        await homeworkApi.bankUpdate(initial.id, payload);
        toast(t('bank.form.updated'), 'success');
      } else {
        await homeworkApi.bankCreate(payload);
        toast(t('bank.form.added'), 'success');
      }
      onSaved();
    } catch (err) {
      toastApiError(toast, err, t('form.toast.saveFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bank-form">
      <Field label={t('bank.form.question')} error={errors.question}>
        <input
          ref={refFor('question')}
          className="text-input"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            clear('question');
          }}
          placeholder={t('bank.form.questionPh')}
        />
      </Field>
      <div className="form-grid">
        <Field label={t('bank.qtype')}>
          <select className="text-input" value={qtype} onChange={(e) => changeQtype(e.target.value as QType)}>
            <option value="single">{t('bank.qtypeSingle')}</option>
            <option value="multiple">{t('bank.qtypeMultiple')}</option>
            <option value="truefalse">{t('bank.qtypeTruefalse')}</option>
            <option value="essay">{t('bank.qtypeEssay')}</option>
          </select>
        </Field>
        <Field label={t('bank.difficulty')}>
          <select
            className="text-input"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          >
            <option value="easy">{t('bank.difficultyEasy')}</option>
            <option value="medium">{t('bank.difficultyMedium')}</option>
            <option value="hard">{t('bank.difficultyHard')}</option>
          </select>
        </Field>
        <Field label={t('bank.form.tag')}>
          <div className="bank-form-row">
            <select
              className="text-input"
              aria-label={t('bank.form.tag')}
              value={tag}
              onChange={(e) => {
                // Chọn tag có sẵn thì xóa ô tag mới (bên nào sửa sau thắng, hiện rõ trên UI)
                setTag(e.target.value);
                setNewTag('');
              }}
            >
              <option value="">{t('bank.form.chooseTag')}</option>
              {tags.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              aria-label={t('bank.form.newTagPh')}
              placeholder={t('bank.form.newTagPh')}
              value={newTag}
              onChange={(e) => {
                // Gõ tag mới thì xóa lựa chọn tag cũ
                setNewTag(e.target.value);
                if (e.target.value) setTag('');
              }}
            />
          </div>
        </Field>
        <Field label={t('bank.subject')}>
          <input
            className="text-input"
            value={subject}
            maxLength={100}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('bank.subjectPh')}
          />
        </Field>
      </div>
      <Field label={t('bank.form.points')} error={errors.points} required>
        <input
          ref={refFor('points')}
          className="text-input"
          type="number"
          min="0.5"
          step="0.5"
          value={points}
          onChange={(e) => {
            setPoints(e.target.value);
            clear('points');
          }}
        />
      </Field>
      {qtype === 'essay' ? (
        <p className="muted">{t('bank.essayHint')}</p>
      ) : (
        <div ref={refFor('answers')} tabIndex={-1}>
          <Field
            label={t(qtype === 'multiple' ? 'bank.answersMultiple' : 'bank.form.answers')}
            error={errors.answers}
            group
          >
            {options.map((o, i) => (
              <div key={i} className="quiz-opt bank-opt">
                <button
                  type="button"
                  className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
                  onClick={() => toggleCorrect(i)}
                  aria-label={t('bank.form.answers')}
                  aria-pressed={o.is_correct}
                >
                  {qtype === 'multiple' ? (o.is_correct ? '☑' : '☐') : o.is_correct ? '●' : '○'}
                </button>
                <input
                  className="text-input input-sm bank-opt-input"
                  value={o.text}
                  disabled={qtype === 'truefalse'}
                  onChange={(e) => {
                    setOptions((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)));
                    clear('answers');
                  }}
                  placeholder={t('form.optionPh', { letter: String.fromCharCode(65 + i) })}
                />
                {qtype !== 'truefalse' && options.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-ghost"
                    onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}
                    aria-label={t('actions.delete', { ns: 'common' })}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {qtype !== 'truefalse' && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setOptions((x) => [...x, { text: '', is_correct: false }])}
              >
                {t('form.addOption')}
              </button>
            )}
          </Field>
        </div>
      )}
      <div className="bank-form-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy
            ? t('actions.saving', { ns: 'common' })
            : initial
              ? t('bank.form.update')
              : t('bank.form.save')}
        </button>
      </div>
    </div>
  );
}
