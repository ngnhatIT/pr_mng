import { useEffect, useState } from 'react';
import { homeworkApi, type QuizAttemptRow } from './homework.api';
import { HomeworkItem, formatDate } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';

export function QuizAttemptsModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<QuizAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    homeworkApi
      .getQuizAttempts(homework.id)
      .then(setRows)
      .catch((err: Error) => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [homework.id]);

  const avg =
    rows.length > 0
      ? rows.reduce((s, r) => s + (r.max_score > 0 ? (r.score / r.max_score) * 100 : 0), 0) / rows.length
      : 0;

  return (
    <Modal title={`Kết quả quiz: ${homework.title}`} onClose={onClose} wide>
      <div className="muted" style={{ marginBottom: 12 }}>
        {rows.length} lượt làm bài · Điểm trung bình {avg.toFixed(1)}%
      </div>
      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon="file" title="Chưa có ai làm bài" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th className="th-right">Điểm</th>
                <th className="th-right">Tỷ lệ</th>
                <th className="th-right">Nộp lúc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.max_score > 0 ? (r.score / r.max_score) * 100 : 0;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.student_name}</td>
                    <td className="td-right">
                      <span className="num" style={{ fontWeight: 700 }}>{r.score}/{r.max_score}</span>
                    </td>
                    <td className="td-right">
                      <span className={`badge ${pct >= 80 ? 'badge-paid' : pct >= 50 ? 'badge-late' : 'badge-overdue'}`}>
                        {pct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="td-right muted">{formatDate(r.submitted_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
