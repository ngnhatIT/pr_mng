import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type BankQuestion } from './homework.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';
import { useDebounce } from '../../shared/hooks/useDebounce';

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
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const debouncedTag = useDebounce(tag, 300);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  // Cache mọi câu hỏi đã thấy để giữ lựa chọn khi đổi filter
  const allSeen = useRef(new Map<number, BankQuestion>());

  const load = async () => {
    setLoading(true);
    try {
      const res = await homeworkApi.bankList(search, tag);
      setQuestions(res.data);
      setTags(res.tags);
      res.data.forEach((q) => allSeen.current.set(q.id, q));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('bank.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [debouncedSearch, debouncedTag]);

  const filteringBank = search.trim() !== '' || tag !== '';

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const doDelete = (id: number) => {
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    const id = deletingId;
    setDeletingId(null);
    try {
      await homeworkApi.bankDelete(id);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('bank.toast.deleteFail'), 'error');
    }
  };

  const doImport = () => {
    if (!onImport || !selected.length) return;
    // Giữ lựa chọn theo ID độc lập với filter: lấy từ cache tất cả câu đã thấy
    const picked = selected.map((id) => allSeen.current.get(id)).filter((q): q is BankQuestion => !!q);
    if (picked.length < selected.length) {
      toast(t('bank.toast.staleSelection', { count: selected.length - picked.length }), 'error');
      return;
    }
    onImport(picked);
    onClose();
  };

  return (
    <Modal title={t('bank.title')} onClose={onClose} wide>
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
        <button className="btn btn-primary hw-action-icon" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={15} /> {t('bank.add')}
        </button>
      </div>

      {showForm && (
        <BankQuestionForm
          tags={tags}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}

      {loading ? (
        <p className="muted">{t('actions.loading', { ns: 'common' })}</p>
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
                }}
              >
                <Icon name="x" size={14} />
                {t('bank.emptyFiltered.clear')}
              </button>
            ) : (
              <button className="btn btn-primary btn-inline" onClick={() => setShowForm(true)}>
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
                  checked={selected.includes(q.id)}
                  onChange={() => toggle(q.id)}
                />
              )}
              <div className="bank-item-body">
                <div className="bank-q">{q.question}</div>
                <div className="muted bank-item-meta">
                  {q.tag && <span className="badge badge-general bank-tag-badge">{q.tag}</span>}
                  {t('bank.meta', { points: q.points, count: q.options.length })}
                </div>
              </div>
              <button className="btn btn-sm btn-danger-ghost" onClick={() => void doDelete(q.id)}>
                {t('actions.delete', { ns: 'common' })}
              </button>
            </div>
          ))}
        </div>
      )}

      {selectMode && (
        <div className="modal-actions">
          <span className="muted">{t('bank.selected', { count: selected.length })}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button className="btn btn-primary hw-action-icon" disabled={!selected.length} onClick={doImport}>
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

function BankQuestionForm({
  tags,
  onClose,
  onSaved,
}: {
  tags: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [tag, setTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const [points, setPoints] = useState('1');
  const [options, setOptions] = useState([
    { text: '', is_correct: true },
    { text: '', is_correct: false },
  ]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!question.trim()) {
      toast(t('bank.form.questionRequired'), 'error');
      return;
    }
    if (options.length < 2 || !options.some((o) => o.is_correct && o.text.trim())) {
      toast(t('bank.form.answersRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await homeworkApi.bankCreate({
        tag: newTag.trim() || tag || null,
        question: question.trim(),
        points: Number(points) || 1,
        options: options.map((o) => ({ text: o.text.trim(), is_correct: o.is_correct })),
      });
      toast(t('bank.form.added'), 'success');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('form.toast.saveFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bank-form">
      <Field label={t('bank.form.question')}>
        <input
          className="text-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('bank.form.questionPh')}
        />
      </Field>
      <div className="form-grid">
        <Field label={t('bank.form.tag')}>
          <div className="bank-form-row">
            <select className="text-input" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{t('bank.form.chooseTag')}</option>
              {tags.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              placeholder={t('bank.form.newTagPh')}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
            />
          </div>
        </Field>
        <Field label={t('bank.form.points')}>
          <input
            className="text-input"
            type="number"
            min="0.5"
            step="0.5"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('bank.form.answers')}>
        {options.map((o, i) => (
          <div key={i} className="quiz-opt bank-opt">
            <button
              type="button"
              className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
              onClick={() => setOptions((x) => x.map((y, j) => ({ ...y, is_correct: j === i })))}
            >
              {o.is_correct ? '●' : '○'}
            </button>
            <input
              className="text-input input-sm bank-opt-input"
              value={o.text}
              onChange={(e) =>
                setOptions((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))
              }
              placeholder={t('form.optionPh', { letter: String.fromCharCode(65 + i) })}
            />
            {options.length > 2 && (
              <button
                type="button"
                className="btn btn-sm btn-danger-ghost"
                onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setOptions((x) => [...x, { text: '', is_correct: false }])}
        >
          {t('form.addOption')}
        </button>
      </Field>
      <div className="bank-form-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('actions.saving', { ns: 'common' }) : t('bank.form.save')}
        </button>
      </div>
    </div>
  );
}
