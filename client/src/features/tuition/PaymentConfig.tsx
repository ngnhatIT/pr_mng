import { useCallback, useEffect, useState } from 'react';
import { paymentsApi, PaymentConfigData } from './tuition.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
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
      toast(err instanceof Error ? err.message : 'Không tải được cấu hình', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof PaymentConfigData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    try {
      await paymentsApi.saveConfig(form);
      toast('Đã lưu cấu hình thanh toán', 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="page">
        <PageHeader
          title="Cấu hình thanh toán"
          desc="Thiết lập tài khoản nhận tiền, VNPay và thưởng giới thiệu"
        />
        {[0, 1, 2].map((i) => (
          <section key={i} className="card" aria-hidden="true">
            <Skeleton width="35%" height={18} />
            <div style={{ marginTop: 14 }}>
              <Skeleton height={12} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Skeleton height={40} radius={8} />
            </div>
          </section>
        ))}
      </div>
    );
  if (!form)
    return (
      <div className="page">
        <PageHeader
          title="Cấu hình thanh toán"
          desc="Thiết lập tài khoản nhận tiền, VNPay và thưởng giới thiệu"
        />
        <EmptyState icon="settings" title="Không tải được cấu hình" desc="Vui lòng thử tải lại trang." />
      </div>
    );

  return (
    <div className="page">
      <PageHeader
        title="Cấu hình thanh toán"
        desc="Thiết lập tài khoản nhận tiền, VNPay và thưởng giới thiệu"
      />
      <form onSubmit={submit}>
        <section className="card">
          <h2 className="card-title">
            <Icon name="banknote" size={18} className="title-icon" />
            Tài khoản ngân hàng nhận tiền
          </h2>
          <p className="card-desc">Dùng để tạo mã VietQR cho phụ huynh quét thanh toán.</p>
          <div className="form-grid">
            <Field label="Ngân hàng">
              <select className="text-input" value={form.pay_bank_code} onChange={set('pay_bank_code')}>
                <option value="">- Chọn ngân hàng -</option>
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số tài khoản">
              <input
                className="text-input mono"
                value={form.pay_bank_account_no}
                onChange={set('pay_bank_account_no')}
              />
            </Field>
            <Field label="Tên chủ tài khoản" span>
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
            VNPay
          </h2>
          <p className="card-desc">Cổng thanh toán online cho phụ huynh.</p>
          <div className="form-grid">
            <Field label="Mã website (TMN Code)">
              <input
                className="text-input mono"
                value={form.pay_vnp_tmncode}
                onChange={set('pay_vnp_tmncode')}
              />
            </Field>
            <Field label="Chuỗi bí mật (Hash Secret)">
              <input
                className="text-input mono"
                type="password"
                value={form.pay_vnp_hashsecret}
                onChange={set('pay_vnp_hashsecret')}
                placeholder={form.pay_vnp_hashsecret === '••••••••' ? 'Đã lưu (để trống nếu không đổi)' : ''}
              />
            </Field>
            <Field label="Trạng thái">
              <select className="text-input" value={form.pay_vnp_enabled} onChange={set('pay_vnp_enabled')}>
                <option value="1">Bật</option>
                <option value="0">Tắt</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <Icon name="gift" size={18} className="title-icon" />
            Thưởng giới thiệu
          </h2>
          <p className="card-desc">Credits tặng khi giới thiệu thành công.</p>
          <div className="form-grid">
            <Field label="Thưởng cho người giới thiệu">
              <input
                className="text-input"
                type="number"
                min={0}
                value={form.referral_reward_referrer}
                onChange={set('referral_reward_referrer')}
              />
            </Field>
            <Field label="Thưởng cho người được giới thiệu">
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
            {busy ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </form>
    </div>
  );
}
