import { useCallback, useEffect, useState } from 'react';
import { teacherApi } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { ClassItem } from '../classes/classes.api';
import { Grade, formatDate } from '../../shared/types';
import './TeacherGrades.css';

export function TeacherGrades() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<{ id: number; name: string; code: string }[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Grade | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  useEffect(() => {
    teacherApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const loadGrades = useCallback(async () => {
    if (!studentId) {
      setGrades([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    try {
      const res = await teacherApi.listGrades(studentId, classId, { page });
      setGrades(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được điểm', 'error');
    } finally {
      setLoading(false);
    }
  }, [studentId, classId, page, toast]);

  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  const pickClass = async (cid: string) => {
    setClassId(cid);
    setStudentId('');
    setStudents([]);
    setGrades([]);
    setPage(1);
    if (!cid) return;
    try {
      const d = await teacherApi.classStudents(cid);
      setStudents(d.students);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được học viên', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await teacherApi.deleteGrade(deleting.id);
      toast('Đã xóa điểm', 'success');
      setDeleting(null);
      void loadGrades();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Điểm số"
        desc="Xem và nhập điểm cho học viên"
        actions={
          studentId ? (
            <button className="btn btn-primary grades-add-btn" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={16} />
              Nhập điểm
            </button>
          ) : undefined
        }
      />

      <div className="toolbar grades-toolbar">
        <select className="text-input" value={classId} onChange={(e) => void pickClass(e.target.value)}>
          <option value="">- Chọn lớp học -</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="text-input"
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setPage(1);
          }}
          disabled={!classId}
        >
          <option value="">- Chọn học viên -</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : !studentId ? (
        <EmptyState icon="cap" title="Chưa chọn học viên" desc="Chọn lớp và học viên để xem / nhập điểm." />
      ) : grades.length === 0 ? (
        <EmptyState
          icon="file"
          title="Chưa có điểm nào"
          desc="Nhấn “+ Nhập điểm” để thêm điểm cho học viên."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bài kiểm tra</th>
                <th>Điểm</th>
                <th>Nhận xét</th>
                <th>Ngày nhập</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>
                    <span
                      className={`score-pill ${
                        g.max_score > 0 && g.score / g.max_score >= 0.5 ? 'score-pass' : 'score-fail'
                      }`}
                    >
                      {g.score}/{g.max_score}
                    </span>
                  </td>
                  <td>{g.comment || '-'}</td>
                  <td>{formatDate(g.created_at)}</td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(g)}>
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {showForm && studentId && (
        <GradeFormModal
          studentId={Number(studentId)}
          classId={classId ? Number(classId) : null}
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            void loadGrades();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa điểm"
          message={`Xóa điểm "${deleting.title}" (${deleting.score}/${deleting.max_score})?`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function GradeFormModal({
  studentId,
  classId,
  onClose,
  onDone,
}: {
  studentId: number;
  classId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('10');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await teacherApi.createGrade({
        student_id: studentId,
        class_id: classId,
        title,
        score: Number(score),
        max_score: Number(maxScore) || 10,
        comment: comment || null,
      });
      toast('Đã nhập điểm', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Nhập điểm thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nhập điểm" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên bài kiểm tra *" span>
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Điểm *">
            <input
              className="text-input"
              type="number"
              step="0.25"
              min={0}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              required
            />
          </Field>
          <Field label="Thang điểm">
            <input
              className="text-input"
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </Field>
          <Field label="Nhận xét" span>
            <textarea
              className="text-input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
