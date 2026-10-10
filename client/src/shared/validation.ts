/**
 * Kiểm tra nhanh định dạng SĐT Việt Nam ở client (UX: báo lỗi ngay khi nhập).
 * Backend vẫn validate lại — đây không phải rào chắn bảo mật.
 */
export function isValidVNPhone(raw: string): boolean {
  // Chuẩn hoá: bỏ khoảng trắng/chấm/gạch, đổi +84 về 0.
  const phone = raw.replace(/[\s.\-()]/g, '').replace(/^\+84/, '0');
  // SĐT VN: số 0 + 9 chữ số (di động 03/05/07/08/09, cố định 02x...).
  return /^0\d{9}$/.test(phone);
}
