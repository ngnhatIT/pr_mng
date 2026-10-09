import { useEffect, useRef, useState } from 'react';
import { homeworkApi, type BankQuestion } from './homework.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';

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
  const toast = useToast();
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  // Cache mọi câu hỏi đã thấy để giữ lựa chọn khi đổi filter
  const allSeen = useRef(new Map<number, BankQuestion>());

  const load = async () => {
    setLoading(true);
    try {
      const res = await homeworkApi.bankList(search, tag);
      setQuestions(res.questions);
      setTags(res.tags);
      res.questions.forEach((q) => allSeen.current.set(q.id, q));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được ngân hàng', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [search, tag]);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const doDelete = async (id: number) => {
    if (!confirm('Xóa câu hỏi này khỏi ngân hàng?')) return;
    try {
      await homeworkApi.bankDelete(id);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  const doImport = () => {
    if (!onImport || !selected.length) return;
    // Giữ lựa chọn theo ID độc lập với filter: lấy từ cache tất cả câu đã thấy
    const picked = selected
      .map((id) => allSeen.current.get(id))
      .filter((q): q is BankQuestion => !!q);
    if (picked.length < selected.length) {
      toast(`Có ${selected.length - picked.length} câu đã chọn không còn trong danh sách`, 'error');
      return;
    }
    onImport(picked);
    onClose();
  };

  return (
    <Modal title="Ngân hàng câu hỏi" onClose={onClose} wide>
      <div className="toolbar">
        <input
          className="text-input search-input"
          placeholder="Tìm câu hỏi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="text-input" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Mọi chủ đề</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + Thêm câu hỏi
        </button>
      </div>

      {showForm && (
        <BankQuestionForm
          tags={tags}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void load(); }}
        />
      )}

      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : questions.length === 0 ? (
        <EmptyState icon="file" title="Ngân hàng trống" desc="Thêm câu hỏi để tái dùng cho nhiều quiz." />
      ) : (
        <div className="bank-list">
          {questions.map((q) => (
            <div key={q.id} className="bank-item">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected.includes(q.id)}
                  onChange={() => toggle(q.id)}
                  style={{ width: 18, height: 18 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{q.question}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {q.tag && <span className="badge badge-general" style={{ marginRight: 6 }}>{q.tag}</span>}
                  {q.points}đ · {q.options.length} đáp án
                </div>
              </div>
              <button className="btn btn-sm btn-danger-ghost" onClick={() => void doDelete(q.id)}>
                Xóa
              </button>
            </div>
          ))}
        </div>
      )}

      {selectMode && (
        <div className="modal-actions">
          <span className="muted">Đã chọn {selected.length} câu</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={!selected.length} onClick={doImport}>
            Import {selected.length} câu
          </button>
        </div>
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
    if (!question.trim()) { toast('Nhập câu hỏi', 'error'); return; }
    if (options.length < 2 || !options.some((o) => o.is_correct && o.text.trim())) {
      toast('Cần ít nhất 2 đáp án và 1 đáp án đúng', 'error');
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
      toast('Đã thêm vào ngân hàng', 'success');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bank-form">
      <Field label="Câu hỏi *">
        <input className="text-input" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="VD: 'Apple' nghĩa là gì?" />
      </Field>
      <div className="form-grid">
        <Field label="Chủ đề">
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="text-input" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">— Chọn —</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="text-input" placeholder="Hoặc tạo mới" value={newTag}
              onChange={(e) => setNewTag(e.target.value)} />
          </div>
        </Field>
        <Field label="Điểm">
          <input className="text-input" type="number" min="0.5" step="0.5" value={points}
            onChange={(e) => setPoints(e.target.value)} />
        </Field>
      </div>
      <Field label="Đáp án (tick vào đáp án đúng)">
        {options.map((o, i) => (
          <div key={i} className="quiz-opt" style={{ marginLeft: 0 }}>
            <button type="button" className={`quiz-correct ${o.is_correct ? 'active' : ''}`}
              onClick={() => setOptions((x) => x.map((y, j) => ({ ...y, is_correct: j === i })))}>
              {o.is_correct ? '●' : '○'}
            </button>
            <input className="text-input input-sm" value={o.text}
              onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))}
              placeholder={`Đáp án ${String.fromCharCode(65 + i)}`} style={{ flex: 1 }} />
            {options.length > 2 && (
              <button type="button" className="btn btn-sm btn-danger-ghost"
                onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-sm"
          onClick={() => setOptions((x) => [...x, { text: '', is_correct: false }])}>
          + Thêm đáp án
        </button>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Hủy</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Đang lưu...' : 'Lưu vào ngân hàng'}
        </button>
      </div>
    </div>
  );
}
