import { useEffect, useState } from 'react';
import { homeworkApi, type HomeworkScoreRow, type Rubric } from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';

export function GradeModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<HomeworkScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await homeworkApi.getScores(homework.id);
      setRows(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được bảng điểm', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    if (homework.rubric_id) {
      homeworkApi.listRubrics().then((rs) => {
        const r = rs.find((x) => x.id === homework.rubric_id);
        if (r) setRubric(r);
      }).catch(() => {});
    }
  }, [homework.id]);

  const startEdit = (row: HomeworkScoreRow) => {
    setEditing(row.student_id);
    setScore(row.score?.toString() ?? '');
    setFeedback(row.feedback ?? '');
  };

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
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu điểm thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  const graded = rows.filter((r) => r.score !== null).length;

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
      <div className="muted" style={{ marginBottom: 12 }}>
        Đã chấm {graded}/{rows.length} học viên
        {homework.max_score != null && ` · Thang điểm ${homework.max_score}`}
      </div>
      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="Chưa có học viên" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Trạng thái</th>
                <th className="th-right">Điểm</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td style={{ fontWeight: 600 }}>{r.student_name}</td>
                  <td>
                    {r.score !== null ? (
                      <span className="badge badge-paid">Đã chấm</span>
                    ) : r.completed ? (
                      <span className="badge badge-upcoming">Đã nộp</span>
                    ) : (
                      <span className="badge badge-general">Chưa nộp</span>
                    )}
                  </td>
                  <td className="td-right">
                    {editing === r.student_id ? (
                      <input
                        className="text-input input-sm"
                        type="number"
                        min="0"
                        step="0.5"
                        value={score}
                        onChange={(e) => setScore(e.target.value)}
                        style={{ width: 90, textAlign: 'right' }}
                        autoFocus
                      />
                    ) : (
                      <span className="num" style={{ fontWeight: 700 }}>
                        {r.score !== null ? r.score : '—'}
                        {homework.max_score != null && <span className="muted">/{homework.max_score}</span>}
                      </span>
                    )}
                  </td>
                  <td className="td-right nowrap">
                    {editing === r.student_id ? (
                      <>
                        <input
                          className="text-input input-sm"
                          placeholder="Nhận xét..."
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          style={{ width: 160, marginRight: 6 }}
                        />
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void save(r.student_id)}>
                          Lưu
                        </button>{' '}
                        <button className="btn btn-sm" onClick={() => setEditing(null)}>Hủy</button>
                      </>
                    ) : (
                      <button className="btn btn-sm" onClick={() => startEdit(r)}>
                        {r.score !== null ? 'Sửa điểm' : 'Chấm'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
