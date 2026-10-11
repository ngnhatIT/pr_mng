import { describe, it, expect } from 'vitest';
import { buildPaymentConfigPayload } from './PaymentConfig';
import { buildZaloPayload } from '../notifications/ZaloReminders';

const payForm = {
  pay_bank_code: 'mb',
  pay_bank_account_no: '123',
  pay_bank_account_name: 'A',
  pay_vnp_tmncode: 'TMN',
  pay_vnp_enabled: '1',
  pay_vnp_hashsecret: 'abcd••••••••wxyz',
  referral_reward_referrer: '0',
  referral_reward_referred: '0',
};

describe('buildPaymentConfigPayload - không bao giờ gửi mask/rỗng cho secret (ADM-9)', () => {
  it('không gõ secret mới -> không có key pay_vnp_hashsecret', () => {
    const p = buildPaymentConfigPayload(payForm, '');
    expect('pay_vnp_hashsecret' in p).toBe(false);
    expect(p.pay_vnp_tmncode).toBe('TMN');
  });
  it('chỉ khoảng trắng cũng coi như không đổi', () => {
    expect('pay_vnp_hashsecret' in buildPaymentConfigPayload(payForm, '   ')).toBe(false);
  });
  it('gõ secret mới -> gửi secret mới', () => {
    expect(buildPaymentConfigPayload(payForm, 'NEWSECRET').pay_vnp_hashsecret).toBe('NEWSECRET');
  });
});

describe('buildZaloPayload - whitelist, không spread response GET (ADM-2)', () => {
  const cfg = {
    zalo_oa_id: 'oa',
    zalo_access_token: 'abcd••••wxyz',
    zalo_template_overdue: 'o',
    zalo_template_upcoming: 'u',
    zalo_enabled: '1',
    center_name: 'C',
    reminder_hour: '08:00',
    reminder_overdue_days: '1',
    reminder_upcoming_days: '3',
    // GET trả kèm secret dạng mask: tuyệt đối không được gửi lại
    zalo_refresh_token: 'rrrr••••rrrr',
    zalo_app_secret: 'ssss••••ssss',
  };
  it('bỏ refresh token/app secret/access token mask', () => {
    const p = buildZaloPayload(cfg, '') as Record<string, unknown>;
    expect(p.zalo_refresh_token).toBeUndefined();
    expect(p.zalo_app_secret).toBeUndefined();
    expect(p.zalo_access_token).toBeUndefined();
    expect(p.zalo_template_overdue).toBe('o');
  });
  it('gõ token mới thì gửi token', () => {
    expect(buildZaloPayload(cfg, 'tok').zalo_access_token).toBe('tok');
  });
});
