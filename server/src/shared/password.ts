import { AppError } from './errors';

/** Mật khẩu phổ biến bị cấm (top passwords từ các vụ leak). */
const COMMON_PASSWORDS = new Set([
  '123456',
  'password',
  '12345678',
  'qwerty',
  '123456789',
  '12345',
  '1234',
  '111111',
  '1234567',
  'dragon',
  '123123',
  'abc123',
  'password1',
  '1234567890',
  '000000',
  'admin',
  'letmein',
  'welcome',
  'monkey',
  '123321',
  'qwerty123',
  '1q2w3e4r',
  'admin123',
  '123abc',
]);

const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate mật khẩu mới: tối thiểu 8 ký tự, không nằm trong danh sách phổ biến.
 * Ném AppError 400 nếu không đạt.
 */
export function assertStrongPassword(password: string, label = 'Mật khẩu'): void {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw AppError.badRequest(`${label} phải từ ${MIN_PASSWORD_LENGTH} ký tự trở lên`, 'WEAK_PASSWORD');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw AppError.badRequest(`${label} quá đơn giản, vui lòng chọn mật khẩu khác`, 'WEAK_PASSWORD');
  }
}
