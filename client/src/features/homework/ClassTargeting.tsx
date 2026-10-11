import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClassItem, classesApi } from '../classes/classes.api';
import { HomeworkItem } from '../../shared/types';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { pruneSelected, type HwFieldErrors } from './homeworkForm';

/** Chọn lớp + đối tượng (cả lớp / từng em) khi giao bài mới. */
export function useClassTargeting(initial: HomeworkItem | null, clear: HwFieldErrors['clear']) {
  const [selectedClasses, setSelectedClasses] = useState<number[]>(initial ? [initial.class_id] : []);
  const [classSearch, setClassSearch] = useState('');
  // Đối tượng: cả lớp hoặc chọn riêng từng em
  const [targetMode, setTargetMode] = useState<'all' | 'selected'>('all');
  const [students, setStudents] = useState<{ id: number; name: string }[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  // Load học viên thuộc các lớp đã chọn (cho giao riêng từng em).
  // Dùng chi tiết từng lớp để chỉ hiện học viên đang học ở các lớp đó; cache theo lớp, chỉ tải lớp mới thêm.
  const classStudentsCache = useRef(new Map<number, { id: number; name: string }[]>());
  useEffect(() => {
    if (targetMode !== 'selected' || !selectedClasses.length) {
      setStudents([]);
      // Bỏ hết lớp → không còn em nào hợp lệ (chế độ 'cả lớp' thì giữ lựa chọn, payload đã gửi [])
      if (!selectedClasses.length) setSelectedStudents((sel) => (sel.length ? [] : sel));
      setStudentsLoading(false);
      return;
    }
    let cancelled = false;
    const cache = classStudentsCache.current;
    const missing = selectedClasses.filter((id) => !cache.has(id));
    setStudentsLoading(missing.length > 0);
    void Promise.all(
      missing.map(
        (id) =>
          classesApi
            .get(id)
            .then((d) =>
              cache.set(
                id,
                (d.students ?? []).map((s) => ({ id: s.id, name: s.name }))
              )
            )
            .catch(() => {}) // lỗi: không cache, lần đổi lớp sau tải lại
      )
    ).then(() => {
      if (cancelled) return;
      const seen = new Set<number>();
      const merged: { id: number; name: string }[] = [];
      for (const id of selectedClasses) {
        for (const s of cache.get(id) ?? []) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        }
      }
      merged.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      setStudents(merged);
      // Bỏ các em không còn thuộc lớp đang chọn (tránh ID cũ khiến server lọc về [] = giao cả lớp)
      setSelectedStudents((sel) => pruneSelected(sel, merged));
      setStudentsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [targetMode, selectedClasses]);

  const toggleClass = (id: number) => {
    clear('classes');
    setSelectedClasses((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const toggleStudent = (id: number) => {
    clear('students');
    setSelectedStudents((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return {
    selectedClasses,
    setSelectedClasses,
    classSearch,
    setClassSearch,
    targetMode,
    setTargetMode,
    students,
    studentsLoading,
    selectedStudents,
    studentSearch,
    setStudentSearch,
    toggleClass,
    toggleStudent,
    // Chỉ gửi học viên còn thuộc lớp đang chọn
    pickedStudents: pruneSelected(selectedStudents, students),
  };
}

export type ClassTargetingState = ReturnType<typeof useClassTargeting>;

/** Hai field "Chọn lớp" + "Giao cho" (chỉ hiện khi tạo bài mới). */
export function ClassTargeting({
  ct,
  classes,
  fe,
}: {
  ct: ClassTargetingState;
  classes: ClassItem[];
  fe: HwFieldErrors;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const { errors, refFor } = fe;
  const { selectedClasses, classSearch, targetMode, students, studentSearch, selectedStudents } = ct;
  const filteredClasses = useMemo(
    () => classes.filter((c) => c.name.toLowerCase().includes(classSearch.toLowerCase())),
    [classes, classSearch]
  );
  const filteredStudents = useMemo(
    () => students.filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase())),
    [students, studentSearch]
  );
  return (
    <>
      <Field label={t('form.selectClass', { count: selectedClasses.length })} error={errors.classes}>
        <input
          ref={refFor('classes')}
          className="text-input hw-mb-8"
          placeholder={t('form.searchClass')}
          value={classSearch}
          onChange={(e) => ct.setClassSearch(e.target.value)}
        />
        <div className="chip-grid">
          {filteredClasses.map((c) => {
            const active = selectedClasses.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`chip ${active ? 'chip-active' : ''}`}
                onClick={() => ct.toggleClass(c.id)}
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
            onClick={() => ct.setSelectedClasses(classes.map((c) => c.id))}
          >
            {t('form.selectAll')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => ct.setSelectedClasses([])}>
            {t('form.deselectAll')}
          </button>
        </div>
      </Field>

      {/* Đối tượng */}
      <Field label={t('form.assignTo')} error={errors.students} group>
        <div className="hw-flex hw-mb-8">
          <button
            type="button"
            className={`btn btn-sm ${targetMode === 'all' ? 'btn-primary' : ''}`}
            onClick={() => ct.setTargetMode('all')}
          >
            {t('form.wholeClass')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${targetMode === 'selected' ? 'btn-primary' : ''}`}
            onClick={() => ct.setTargetMode('selected')}
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
              onChange={(e) => ct.setStudentSearch(e.target.value)}
            />
            <div className="chip-grid">
              {filteredStudents.map((s) => {
                const active = selectedStudents.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip ${active ? 'chip-active' : ''}`}
                    onClick={() => ct.toggleStudent(s.id)}
                  >
                    {active && <Icon name="check" size={12} />}
                    {s.name}
                  </button>
                );
              })}
              {filteredStudents.length === 0 && (
                <div className="hw-empty-inline">
                  <Icon name="users" size={18} />
                  <span>
                    {ct.studentsLoading
                      ? t('form.loadingStudents')
                      : selectedClasses.length === 0
                        ? t('form.pickClassFirst')
                        : t('form.noResults')}
                  </span>
                </div>
              )}
            </div>
            <div className="muted hw-text-13 hw-mt-4">
              {t('form.selectedCount', { count: ct.pickedStudents.length })}
            </div>
          </>
        )}
      </Field>
    </>
  );
}
