import {
  ReactNode,
  cloneElement,
  isValidElement,
  useCallback,
  useRef,
  useState,
  type ReactElement,
} from 'react';

export function Field({
  label,
  children,
  span,
  error,
  required,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
  /** Lỗi validation hiển thị inline ngay dưới field (thay vì chỉ toast). */
  error?: string;
  required?: boolean;
}) {
  const errorId = `${label}-error`;
  // Gắn aria-invalid + aria-describedby vào input con để screen reader đọc lỗi
  const enhanced = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })
    : children;
  return (
    <label className={`field${span ? ' field-span' : ''}${error ? ' field-invalid' : ''}`}>
      <span className="field-label">
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {enhanced}
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

/**
 * Lỗi validation inline dùng chung cho các form (skill 8.2):
 * giữ map lỗi theo tên field, hiển thị dưới field qua `Field error={...}`,
 * và focus vào field đầu tiên bị lỗi sau submit. Dữ liệu đã nhập giữ nguyên.
 */
export function useFieldErrors<T extends string>() {
  const [errors, setErrors] = useState<Partial<Record<T, string>>>({});
  const refs = useRef<Partial<Record<T, HTMLElement | null>>>({});

  // ref gán cho input/select/textarea trong Field: ref={refFor('name')}
  const refFor = useCallback(
    (k: T) => (el: HTMLElement | null) => {
      refs.current[k] = el;
    },
    []
  );

  // Hiển thị lỗi; trả về true nếu không có lỗi nào. Focus field lỗi đầu tiên
  // (theo thứ tự field trong object errs truyền vào).
  const show = useCallback((errs: Partial<Record<T, string>>) => {
    setErrors(errs);
    const first = (Object.keys(errs) as T[])[0];
    if (first) refs.current[first]?.focus();
    return Object.keys(errs).length === 0;
  }, []);

  // Xóa lỗi của 1 field khi user sửa lại
  const clear = useCallback((k: T) => {
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }, []);

  return { errors, refFor, show, clear };
}
