import { ReactNode, cloneElement, isValidElement, type ReactElement } from 'react';

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
