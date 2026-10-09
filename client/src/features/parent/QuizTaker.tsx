import { useEffect, useState } from 'react';
import { parentApi, type QuizQuestion, type QuizAttempt } from './parent.api';
import { HomeworkItem } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';

interface QuizAttemptDetail {
  question_id: number;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}

export function QuizTaker({
  homework,
  studentId,
  onClose,
  onDone,
}: {
  homework: HomeworkItem;
  studentId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; max_score: number; attempt_id: number; attempt_no: number } | null>(null);
  const [review, setReview] = useState<QuizAttemptDetail[] | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [history, setHistory] = useState<QuizAttempt[]>([]);

  useEffect(() => {
    parentApi
      .getQuizAttempts(homework.id, studentId)
      .then(setHistory)
      .catch(() => {});
  }, [homework.id, studentId]);

  useEffect(() => {
    parentApi
      .getQuiz(homework.id, studentId)
      .then(setQuestions)
      .catch((err: Error) => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [homework.id]);

  const submit = async () => {
    if (Object.keys(answers).length < questions.length) {
      toast(`Còn ${questions.length - Object.keys(answers).length} câu chưa trả lời`, 'error');
      return;
    }
    if (!confirm('Nộp bài? Bạn vẫn có thể làm lại để cải thiện điểm.')) return;
    setSubmitting(true);
    try {
      const res = await parentApi.submitQuiz(
        homework.id,
        studentId,
        Object.entries(answers).map(([qid, oid]) => ({ question_id: Number(qid), option_id: oid }))
      );
      setResult(res);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Nộp bài thất bại', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const loadReview = async (attemptId: number) => {
    try {
      const r = await parentApi.getAttemptReview(attemptId, studentId);
      setReview(r);
      setShowReview(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được đáp án', 'error');
    }
  };

  const pct = result && result.max_score > 0 ? (result.score / result.max_score) * 100 : 0;

  return (
    <Modal title={`Quiz: ${homework.title}`} onClose={onClose} wide>
      {/* Thông tin quiz + lịch sử làm bài */}
      {!result && !showReview && (
        <div className="quiz-info-bar">
          <span className="muted" style={{ fontSize: 13 }}>
            {questions.length} câu
            {homework.max_score != null && ` · ${homework.max_score}đ`}
            {homework.due_date && ` · Hạn: ${homework.due_date}`}
          </span>
          {history.length > 0 && (
            <span className="muted" style={{ fontSize: 13 }}>
              Đã làm {history.length} lần · Cao nhất:{' '}
              <strong>{Math.max(...history.map((h) => h.score))}/{history[0].max_score}đ</strong>
            </span>
          )}
        </div>
      )}
      {loading ? (
        <p className="muted">Đang tải đề...</p>
      ) : result ? (
        <div className="quiz-result">
          <div className="quiz-result-score">
            {result.score}/{result.max_score}
          </div>
          <div>
            <span className={`badge ${pct >= 80 ? 'badge-paid' : pct >= 50 ? 'badge-late' : 'badge-overdue'}`}>
              {pct.toFixed(0)}%
            </span>
            {result.attempt_no > 1 && (
              <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
                Lần làm thứ {result.attempt_no} — giữ điểm cao nhất
              </span>
            )}
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            {pct >= 80 ? 'Xuất sắc! 🎉' : pct >= 50 ? 'Khá tốt, cố gắng thêm nhé!' : 'Cần ôn lại bài nhé!'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn" onClick={() => void loadReview(result.attempt_id)}>
              Xem đáp án
            </button>
            <button className="btn btn-primary" onClick={onClose}>Đóng</button>
          </div>
        </div>
      ) : showReview && review ? (
        <div className="quiz-review">
          {review.map((q, qi) => {
            const gotIt = q.options.some((o) => o.chosen && o.is_correct);
            return (
              <div key={q.question_id} className={`quiz-review-q ${gotIt ? 'correct' : 'wrong'}`}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {gotIt ? '✓' : '✗'} Câu {qi + 1}: {q.question}
                </div>
                {q.options.map((o) => (
                  <div
                    key={o.id}
                    className={`quiz-review-opt ${o.is_correct ? 'is-correct' : ''} ${o.chosen && !o.is_correct ? 'is-wrong-choice' : ''}`}
                  >
                    {o.is_correct ? '✓ ' : o.chosen ? '→ ' : '○ '}
                    {o.text}
                    {o.chosen && <span className="muted" style={{ fontSize: 12 }}> (bạn chọn)</span>}
                  </div>
                ))}
              </div>
            );
          })}
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowReview(false)}>Quay lại</button>
            <button className="btn btn-primary" onClick={onClose}>Đóng</button>
          </div>
        </div>
      ) : questions.length === 0 ? (
        <EmptyState icon="file" title="Chưa có câu hỏi" />
      ) : (
        <>
          {questions.map((q, qi) => (
            <div key={q.id} className="quiz-take-q">
              <div style={{ fontWeight: 600, marginBottom: 12 }}>
                Câu {qi + 1}: {q.question}
                <span className="muted" style={{ fontWeight: 400 }}> ({q.points}đ)</span>
              </div>
              {q.options.map((o) => (
                <div
                  key={o.id}
                  className={`quiz-take-opt ${answers[q.id] === o.id ? 'selected' : ''}`}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                >
                  <span className="quiz-correct" style={{ pointerEvents: 'none' }}>
                    {answers[q.id] === o.id ? '●' : '○'}
                  </span>
                  {o.text}
                </div>
              ))}
            </div>
          ))}
          <div className="modal-actions">
            <span className="muted">
              Đã trả lời {Object.keys(answers).length}/{questions.length} câu
            </span>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Để sau</button>
            <button className="btn btn-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'Đang chấm...' : 'Nộp bài'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
