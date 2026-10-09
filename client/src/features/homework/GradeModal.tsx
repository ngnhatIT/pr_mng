import { useEffect, useState } from 'react';
import { homeworkApi, type HomeworkScoreRow, type Rubric } from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';

function rowStatus(r: HomeworkScoreRow) {
  if (r.score !== null) return <span className="badge badge-paid">Đã chấm</span>;
  if (r.completed) return <span className="badge badge-upcoming">Đã nộp</span>;
  return <span className="badge badge-general">Chưa nộp</span>;
}

export function GradeModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<HomeworkScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (keepSelection: boolean) => {
    setLoading(true);
    try {
      const data = await homeworkApi.getScores(homework.id);
      setRows(data);
      setSelected((prev) => {
        if (keepSelection && prev !== null && data.some((r) => r.student_id === prev)) return prev;
        const next = data.find((r) => r.score === null) ?? data[0];
        return next ? next.student_id : null;
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được bảng điểm', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    if (homework.rubric_id) {
      homeworkApi.listRubrics().then((rs) => {
        const r = rs.find((x) => x.id === homework.rubric_id);
        if (r) setRubric(r);
      }).catch(() => {});
    }
  }, [homework.id]);

  const selectRow = (row: HomeworkScoreRow) => {
    setSelected(row.student_id);
  };

  // Đồng bộ form chấm theo học viên đang chọn (kể cả sau khi tải lại)
  useEffect(() => {
    const row = rows.find((r) => r.student_id === selected);
    if (row) {
      setScore(row.score?.toString() ?? '');
      setFeedback(row.feedback ?? '');
    }
  }, [selected, rows]);

  const save = async (studentId: number) => {
    setBusy(true);
    try {
      const s = score === '' ? null : Number(score);
      if (s !== null && (!Number.isFinite(s) || s < 0)) {
        toast('Điểm không hợp lệ', 'error');
        return;
      }
      if (homework.max_score != null && s !== null && s > homework.max_score) {
        toast(`Điểm không vượt quá ${homework.max_score}`, 'error');
        return;
      }
      await homeworkApi.grade(homework.id, studentId, s, feedback);
      toast('Đã lưu điểm', 'success');
      void load(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu điểm thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  const graded = rows.filter((r) => r.score !== null).length;
  const pct = rows.length > 0 ? Math.round((graded / rows.length) * 100) : 0;
  const current = rows.find((r) => r.student_id === selected);

  return (
    <Modal title={`Chấm điểm: ${homework.title}`} onClose={onClose} wide>
      {rubric && (
        <div className="rubric-banner">
          <strong>Rubric: {rubric.name}</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            {rubric.criteria.map((c) => `${c.name} (${c.max_score}đ)`).join(' · ')}
          </div>
        </div>
      )}
      <div className="grade-progress">
        <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          Đã chấm <strong className="num">{graded}/{rows.length}</strong>
          {homework.max_score != null && ` · Thang điểm ${homework.max_score}`}
        </span>
        <div className="hw-progress-track" aria-hidden="true">
          <div className="hw-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="Chưa có học viên" />
      ) : (
        <div className="grade-layout">
          {/* Vùng trái: danh sách học viên */}
          <div className="grade-list" role="listbox" aria-label="Danh sách học viên">
            {rows.map((r) => (
              <button
                key={r.student_id}
                type="button"
                className={`grade-row ${selected === r.student_id ? 'selected' : ''}`}
                onClick={() => selectRow(r)}
                role="option"
                aria-selected={selected === r.student_id}
              >
                <span className="grade-name">{r.student_name}</span>
                {rowStatus(r)}
                <span className="num">
                  {r.score !== null ? r.score : '-'}
                </span>
              </button>
            ))}
          </div>

          {/* Vùng phải: form chấm điểm */}
          <div className="grade-panel">
            {current ? (
              <>
                <div className="grade-panel-head">
                  <span className="grade-name">{current.student_name}</span>
                  {rowStatus(current)}
                </div>
                <div className="grade-score-row">
                  <input
                    className="text-input grade-score-input"
                    type="number"
                    min="0"
                    step="0.5"
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    placeholder="Điểm"
                    aria-label="Điểm"
                  />
                  {homework.max_score != null && (
                    <span className="muted">/ {homework.max_score}</span>
                  )}
                </div>
                <textarea
                  className="text-input"
                  rows={3}
                  placeholder="Nhận xét cho học viên..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  aria-label="Nhận xét"
                />
                <div className="modal-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                  <button className="btn btn-primary hw-action-icon" disabled={busy} onClick={() => void save(current.student_id)}>
                    <Icon name="check" size={15} /> {busy ? 'Đang lưu...' : 'Lưu điểm'}
                  </button>
                </div>
              </>
            ) : (
              <EmptyState icon="pencil" title="Chọn học viên để chấm" desc="Bấm vào tên trong danh sách bên trái." />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
