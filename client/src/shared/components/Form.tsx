import {
  ReactNode,
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
} from 'react';
import { formatVND } from '../types';

export function Field({
  label,
  children,
  span,
  error,
  required,
  hint,
  group,
  errorId: errorIdProp,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
  /** Lỗi validation hiển thị inline ngay dưới field (thay vì chỉ toast). */
  error?: string;
  required?: boolean;
  /** Gợi ý ngắn dưới field, giúp người không rành kỹ thuật hiểu setting. Ẩn khi có lỗi. */
  hint?: string;
  /**
   * Con là cụm nhiều control (nhóm nút, danh sách đính kèm...): render <div role="group">
   * thay vì <label> — click chữ trong <label> sẽ kích hoạt nút đầu tiên bên trong.
   */
  group?: boolean;
  /** id cho lỗi, để control trong cụm (group) tự gắn aria-describedby vào đúng ô sai (B5-3). */
  errorId?: string;
}) {
  const uid = useId();
  const errorId = errorIdProp ?? `${uid}-error`;
  const labelId = `${uid}-label`;
  // Gắn aria-invalid + aria-describedby vào input con để screen reader đọc lỗi
  const enhanced = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })
    : children;
  const Wrapper = group ? 'div' : 'label';
  return (
    <Wrapper
      className={`field${span ? ' field-span' : ''}${error ? ' field-invalid' : ''}`}
      {...(group
        ? { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': error ? errorId : undefined }
        : {})}
    >
      <span className="field-label" id={labelId}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {enhanced}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </Wrapper>
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

  // Xóa lỗi của 1 field khi user sửa lại. Xóa hẳn key (thay vì gán undefined)
  // để show() không đếm nhầm key đã xóa thành lỗi khi merge nhiều nguồn lỗi.
  const clear = useCallback((k: T) => {
    setErrors((e) => {
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
  }, []);

  return { errors, refFor, show, clear };
}

/**
 * Chuẩn hóa giá trị tiền về chuỗi chữ số: number -> làm tròn; "1500000.00" (numeric từ DB, 1-2 số lẻ) -> "1500000";
 * còn lại bỏ mọi ký tự không phải số ("1.500.000", "1,500,000 VND" -> "1500000").
 */
export function moneyDigits(v: string | number | null | undefined): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
  const s = String(v ?? '').trim();
  if (/^\d+\.\d{1,2}$/.test(s)) return String(Math.round(Number(s)));
  return s.replace(/\D/g, '');
}

/**
 * UX-7: ô nhập tiền. type="text" + inputMode="numeric" (bàn phím số trên mobile, cuộn chuột không đổi giá trị
 * như type="number"), chỉ giữ chữ số, và hiện lại số tiền đã định dạng ngay dưới ô (2.000.000đ) để soát
 * nhầm số 0. value/onChange là chuỗi chữ số ('' = trống); caller tự Number(value) khi submit.
 *
 *   <Field label={t('amount')} error={errors.amount}>
 *     <MoneyInput value={amount} onChange={setAmount} ref={refFor('amount')} required />
 *   </Field>
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    value: string | number | null | undefined;
    onChange: (digits: string) => void;
  }
>(function MoneyInput({ value, onChange, ...rest }, ref) {
  const digits = moneyDigits(value);
  return (
    <>
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={digits}
        onChange={(e) => onChange(moneyDigits(e.target.value))}
      />
      {digits && (
        <span className="field-hint money-echo" aria-live="polite">
          {formatVND(Number(digits))}
        </span>
      )}
    </>
  );
});
