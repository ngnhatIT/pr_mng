import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentsApi, PaymentConfigData } from './tuition.api';
import { useToast } from '../../shared/ui/toast';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './PaymentConfig.css';

const BANKS = [
  { code: 'vietcombank', label: 'Vietcombank' },
  { code: 'vietinbank', label: 'Vietinbank' },
  { code: 'bidv', label: 'BIDV' },
  { code: 'agribank', label: 'Agribank' },
  { code: 'mb', label: 'MB Bank' },
  { code: 'tpbank', label: 'TPBank' },
  { code: 'techcombank', label: 'Techcombank' },
  { code: 'vpbank', label: 'VPBank' },
];

export function PaymentConfig() {
  const { t } = useTranslation(['tuition', 'common']);
  const [form, setForm] = useState<PaymentConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await paymentsApi.getConfig();
      setForm(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('config.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof PaymentConfigData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const { errors, refFor, show, clear } = useFieldErrors<'pay_vnp_tmncode' | 'pay_vnp_hashsecret'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    // Bật VNPay mà thiếu thông tin thì cổng thanh toán sẽ gãy: chặn ngay tại form
    if (form.pay_vnp_enabled === '1') {
      const errs: { pay_vnp_tmncode?: string; pay_vnp_hashsecret?: string } = {};
      if (!form.pay_vnp_tmncode.trim()) errs.pay_vnp_tmncode = t('config.vnpay.errors.tmnRequired');
      if (!form.pay_vnp_hashsecret.trim()) errs.pay_vnp_hashsecret = t('config.vnpay.errors.secretRequired');
      if (!show(errs)) return;
    }
    setBusy(true);
    try {
      // CRITICAL: không bao giờ gửi secret dạng mask ('••••••••' hoặc 'abcd••••••••wxyz')
      // lên server, giữ nguyên secret cũ khi người dùng không đổi.
      const payload: Partial<PaymentConfigData> = { ...form };
      if (payload.pay_vnp_hashsecret?.includes('•')) {
        delete payload.pay_vnp_hashsecret;
      }
      await paymentsApi.saveConfig(payload);
      toast(t('config.saved'), 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="page">
        <PageHeader title={t('config.title')} desc={t('config.pageDesc')} />
        {[0, 1, 2].map((i) => (
          <section key={i} className="card" aria-hidden="true">
            <Skeleton width="35%" height={18} />
            <div style={{ marginTop: 14 }}>
              <Skeleton height={12} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Skeleton height={40} radius={8} />
            </div>
          </section>
        ))}
      </div>
    );
  if (!form)
    return (
      <div className="page">
        <PageHeader title={t('config.title')} desc={t('config.pageDesc')} />
        <EmptyState
          icon="alert"
          title={t('config.loadFailTitle')}
          desc={t('config.loadFailDesc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={14} />
              {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      </div>
    );

  return (
    <div className="page">
      <PageHeader title={t('config.title')} desc={t('config.pageDesc')} />
      <form onSubmit={submit}>
        <section className="card">
          <h2 className="card-title">
            <Icon name="banknote" size={18} className="title-icon" />
            {t('config.bank.title')}
          </h2>
          <p className="card-desc">{t('config.desc')}</p>
          <div className="form-grid">
            <Field label={t('config.bank.bank')}>
              <select className="text-input" value={form.pay_bank_code} onChange={set('pay_bank_code')}>
                <option value="">{t('config.bank.selectBank')}</option>
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('config.bank.accountNo')}>
              <input
                className="text-input mono"
                value={form.pay_bank_account_no}
                onChange={set('pay_bank_account_no')}
              />
            </Field>
            <Field label={t('config.bank.accountName')} span>
              <input
                className="text-input"
                value={form.pay_bank_account_name}
                onChange={set('pay_bank_account_name')}
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <Icon name="card" size={18} className="title-icon" />
            {t('config.vnpay.title')}
          </h2>
          <p className="card-desc">{t('config.vnpay.desc')}</p>
          <div className="form-grid">
            <Field
              label={t('config.vnpay.tmnCode')}
              hint={t('config.vnpay.tmnCodeHint')}
              error={errors.pay_vnp_tmncode}
            >
              <input
                className="text-input mono"
                value={form.pay_vnp_tmncode}
                onChange={(e) => {
                  set('pay_vnp_tmncode')(e);
                  clear('pay_vnp_tmncode');
                }}
                ref={refFor('pay_vnp_tmncode')}
              />
            </Field>
            <Field
              label={t('config.vnpay.hashSecret')}
              hint={t('config.vnpay.hashSecretHint')}
              error={errors.pay_vnp_hashsecret}
            >
              <input
                className="text-input mono"
                type="password"
                value={form.pay_vnp_hashsecret}
                onChange={(e) => {
                  set('pay_vnp_hashsecret')(e);
                  clear('pay_vnp_hashsecret');
                }}
                ref={refFor('pay_vnp_hashsecret')}
                onFocus={(e) => {
                  // Xoá mask khi focus để người dùng nhập secret mới sạch sẽ
                  if (e.target.value.includes('•')) {
                    setForm((f) => (f ? { ...f, pay_vnp_hashsecret: '' } : f));
                  }
                }}
                placeholder={
                  form.pay_vnp_hashsecret.includes('•')
                    ? t('config.vnpay.savedPlaceholder')
                    : t('config.vnpay.newSecretPlaceholder')
                }
              />
            </Field>
            <Field label={t('config.vnpay.status')} hint={t('config.vnpay.statusHint')}>
              <select
                className="text-input"
                value={form.pay_vnp_enabled}
                onChange={(e) => {
                  set('pay_vnp_enabled')(e);
                  clear('pay_vnp_tmncode');
                  clear('pay_vnp_hashsecret');
                }}
              >
                <option value="1">{t('config.vnpay.enabled')}</option>
                <option value="0">{t('config.vnpay.disabled')}</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <Icon name="gift" size={18} className="title-icon" />
            {t('config.referral.title')}
          </h2>
          <p className="card-desc">{t('config.referral.desc')}</p>
          <div className="form-grid">
            <Field label={t('config.referral.forReferrer')}>
              <input
                className="text-input"
                type="number"
                min={0}
                value={form.referral_reward_referrer}
                onChange={set('referral_reward_referrer')}
              />
            </Field>
            <Field label={t('config.referral.forReferred')}>
              <input
                className="text-input"
                type="number"
                min={0}
                value={form.referral_reward_referred}
                onChange={set('referral_reward_referred')}
              />
            </Field>
          </div>
        </section>

        <div className="toolbar payment-savebar">
          <span className="spacer" />
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('config.saveConfig')}
          </button>
        </div>
      </form>
    </div>
  );
}
