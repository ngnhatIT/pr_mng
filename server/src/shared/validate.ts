import { AppError } from './errors';

/**
 * Validator tối giản, không dependency ngoài.
 * Dùng ở đầu mỗi handler để chặn input bẩn sớm với message tiếng Việt rõ ràng.
 *
 * Ví dụ:
 *   const { name, phone } = validate(req.body, {
 *     name: v.string({ required: true, min: 1, max: 100, label: 'Tên học viên' }),
 *     phone: v.string({ pattern: /^0\d{9}$/, label: 'Số điện thoại' }),
 *     age: v.number({ min: 1, max: 100 }),
 *   });
 */

type Rule =
  | {
      kind: 'string';
      required?: boolean;
      min?: number;
      max?: number;
      pattern?: RegExp;
      label?: string;
      trim?: boolean;
      enum?: string[];
      /** Kiểm tra ngày thật (không chỉ đúng pattern) */
      isDate?: boolean;
    }
  | { kind: 'number'; required?: boolean; min?: number; max?: number; integer?: boolean; label?: string }
  | { kind: 'boolean'; required?: boolean; label?: string }
  | { kind: 'any'; required?: boolean; label?: string };

type Schema = Record<string, Rule>;

/** Kiểu output suy ra từ schema: string/number/boolean theo kind. */
type BaseOf<R> = R extends { kind: 'number' }
  ? number
  : R extends { kind: 'boolean' }
    ? boolean
    : R extends { kind: 'string' }
      ? string
      : unknown;

/** Kiểu output suy ra từ schema: required=true -> không undefined. */
export type Validated<T extends Schema> = {
  [K in keyof T]: T[K] extends { required: true } ? BaseOf<T[K]> : BaseOf<T[K]> | undefined;
};

type StringRule = Extract<Rule, { kind: 'string' }>;
type NumberRule = Extract<Rule, { kind: 'number' }>;
type BooleanRule = Extract<Rule, { kind: 'boolean' }>;
type AnyRule = Extract<Rule, { kind: 'any' }>;

export const v = {
  string: <O extends Omit<StringRule, 'kind'>>(o: O = {} as O): O & { kind: 'string' } =>
    ({ kind: 'string', trim: true, ...o }) as O & { kind: 'string' },
  number: <O extends Omit<NumberRule, 'kind'>>(o: O = {} as O): O & { kind: 'number' } =>
    ({ kind: 'number', ...o }) as O & { kind: 'number' },
  boolean: <O extends Omit<BooleanRule, 'kind'>>(o: O = {} as O): O & { kind: 'boolean' } =>
    ({ kind: 'boolean', ...o }) as O & { kind: 'boolean' },
  any: <O extends Omit<AnyRule, 'kind'>>(o: O = {} as O): O & { kind: 'any' } =>
    ({ kind: 'any', ...o }) as O & { kind: 'any' },
  /** Ngày YYYY-MM-DD thật (kiểm tra ngày tồn tại, không chỉ đúng pattern). */
  date: (o: { required?: boolean; label?: string } = {}) =>
    ({
      kind: 'string',
      trim: true,
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      isDate: true,
      ...o,
    }) as unknown as StringRule & { kind: 'string' },
};

/** Kiểm tra chuỗi YYYY-MM-DD là ngày thật (loại "2026-13-99"). */
function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function labelOf(rule: Rule, key: string): string {
  return (rule as { label?: string }).label || key;
}

export function validate<T extends Schema>(input: unknown, schema: T): Validated<T> {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    const rule = schema[key];
    const label = labelOf(rule, key);
    let val = src[key];

    if (val === undefined || val === null || val === '') {
      if (rule.required) throw AppError.badRequest(`${label} là bắt buộc`, 'VALIDATION_REQUIRED');
      out[key] = undefined;
      continue;
    }

    if (rule.kind === 'string') {
      if (typeof val !== 'string') val = String(val);
      let s = val as string;
      if (rule.trim) s = s.trim();
      if (rule.required && !s) throw AppError.badRequest(`${label} là bắt buộc`, 'VALIDATION_REQUIRED');
      if (rule.min !== undefined && s.length < rule.min)
        throw AppError.badRequest(`${label} phải có ít nhất ${rule.min} ký tự`, 'VALIDATION_MIN');
      if (rule.max !== undefined && s.length > rule.max)
        throw AppError.badRequest(`${label} tối đa ${rule.max} ký tự`, 'VALIDATION_MAX');
      if (rule.pattern && !rule.pattern.test(s))
        throw AppError.badRequest(`${label} không đúng định dạng`, 'VALIDATION_FORMAT');
      if (rule.isDate && !isRealDate(s))
        throw AppError.badRequest(`${label} không phải ngày hợp lệ (YYYY-MM-DD)`, 'VALIDATION_DATE');
      if (rule.enum && !rule.enum.includes(s))
        throw AppError.badRequest(`${label} không hợp lệ`, 'VALIDATION_ENUM');
      out[key] = s;
    } else if (rule.kind === 'number') {
      const n = typeof val === 'number' ? val : Number(val);
      if (!Number.isFinite(n)) throw AppError.badRequest(`${label} phải là số`, 'VALIDATION_TYPE');
      if (rule.integer && !Number.isInteger(n))
        throw AppError.badRequest(`${label} phải là số nguyên`, 'VALIDATION_TYPE');
      if (rule.min !== undefined && n < rule.min)
        throw AppError.badRequest(`${label} tối thiểu ${rule.min}`, 'VALIDATION_MIN');
      if (rule.max !== undefined && n > rule.max)
        throw AppError.badRequest(`${label} tối đa ${rule.max}`, 'VALIDATION_MAX');
      out[key] = n;
    } else if (rule.kind === 'boolean') {
      out[key] = val === true || val === 'true' || val === 1;
    } else {
      out[key] = val;
    }
  }
  return out as Validated<T>;
}

/** Lấy id số từ req.params, ném 400 nếu không hợp lệ. */
export function paramId(params: Record<string, string>, name = 'id'): number {
  const n = Number(params[name]);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('ID không hợp lệ', 'VALIDATION_ID');
  return n;
}
