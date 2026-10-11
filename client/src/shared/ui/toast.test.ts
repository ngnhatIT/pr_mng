import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../../i18n';
import { toastApiError } from './toast';

function apiErr(message: string, code?: string, requestId?: string) {
  return Object.assign(new Error(message), { code, requestId });
}

afterEach(async () => {
  await i18n.changeLanguage('vi');
});

describe('toastApiError (UX-2)', () => {
  it('vi + mã chung BAD_REQUEST: giữ câu cụ thể của server, không thay bằng text chung', async () => {
    await i18n.changeLanguage('vi');
    const toast = vi.fn();
    toastApiError(toast, apiErr('Số tiền vượt quá số còn nợ (300.000đ)', 'BAD_REQUEST'), 'fallback');
    expect(toast).toHaveBeenCalledWith('Số tiền vượt quá số còn nợ (300.000đ)', 'error');
  });

  it('en + mã có trong api.errors: dùng text theo mã (server chỉ nói tiếng Việt)', async () => {
    await i18n.changeLanguage('en');
    const toast = vi.fn();
    toastApiError(toast, apiErr('Yêu cầu không hợp lệ', 'BAD_REQUEST'), 'fallback');
    expect(toast).toHaveBeenCalledWith(i18n.t('api.errors.BAD_REQUEST', { ns: 'common' }), 'error');
    expect(toast.mock.calls[0][0]).not.toBe('Yêu cầu không hợp lệ');
  });

  it('5xx INTERNAL_ERROR: dùng câu chung theo mã thay cho "Lỗi máy chủ"', () => {
    const toast = vi.fn();
    toastApiError(toast, apiErr('Lỗi máy chủ', 'INTERNAL_ERROR'), 'fallback');
    expect(toast).toHaveBeenCalledWith(i18n.t('api.errors.INTERNAL_ERROR', { ns: 'common' }), 'error');
  });

  it('gắn request_id; lỗi không phải Error -> fallback', () => {
    const toast = vi.fn();
    toastApiError(toast, apiErr('Lỗi X', 'CONFLICT', 'req-123'), 'fallback');
    expect(toast.mock.calls[0][0]).toMatch(/^Lỗi X \(.+: req-123\)$/);
    toastApiError(toast, 'boom', 'fallback');
    expect(toast).toHaveBeenLastCalledWith('fallback', 'error');
  });
});
