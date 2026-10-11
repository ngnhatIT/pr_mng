import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Field } from './Form';
import { Icon } from './icons';
import { LoadError } from './EmptyState';
import { http } from '../api/client';
import { useLoad } from '../hooks/useLoad';
import { toastApiError, useToast } from '../ui/toast';

type Status = { enabled: boolean; recovery_left: number };

/** Nhóm secret base32 thành khối 4 ký tự cho dễ gõ tay vào app xác thực. */
const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

/**
 * Xác thực 2 lớp cho tài khoản nhân sự: thiết lập (secret + link otpauth) -> nhập mã -> hiện mã khôi phục 1 lần;
 * đang bật thì cho tắt (mật khẩu + mã).
 */
export function TwoFactorModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('auth');
  const toast = useToast();
  const { data: status, error: loadError, reload } = useLoad(() => http.get<Status>('/auth/2fa'), []);
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      const c = (err as { code?: string }).code;
      if (c === 'MFA_INVALID_CODE' || c === 'WRONG_PASSWORD') setError(t(`twofa.errors.${c}`));
      else toastApiError(toast, err, t('twofa.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setSetup(await http.post('/auth/2fa/setup')));
  const enable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await http.post<{ recovery_codes: string[] }>('/auth/2fa/enable', { code: code.trim() });
      setRecovery(r.recovery_codes);
      setSetup(null);
      setCode('');
      reload();
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await http.post('/auth/2fa/disable', { password, code: code.trim() });
      toast(t('twofa.disabled'), 'success');
      setPassword('');
      setCode('');
      reload();
    });
  };
  const copyCodes = () => {
    void navigator.clipboard?.writeText(recovery!.join('\n')).then(() => toast(t('twofa.copied'), 'success'));
  };

  const codeField = (label: string) => (
    <Field label={label} span error={error || undefined}>
      <input
        className="text-input"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError('');
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={20}
        required
        autoFocus
      />
    </Field>
  );

  return (
    <Modal title={t('twofa.title')} onClose={onClose} dirty={!!setup || !!recovery}>
      {recovery ? (
        <div className="twofa">
          <p>
            <strong>{t('twofa.enabledNow')}</strong> {t('twofa.saveCodes')}
          </p>
          <ul className="twofa-codes mono">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={copyCodes}>
              <Icon name="clipboard" size={14} />
              {t('twofa.copy')}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('twofa.savedDone')}
            </button>
          </div>
        </div>
      ) : loadError && !status ? (
        <LoadError onRetry={reload} />
      ) : !status ? (
        <p className="muted">
          <span className="spinner" aria-hidden="true" /> {t('actions.loading', { ns: 'common' })}
        </p>
      ) : status.enabled ? (
        <form onSubmit={disable} className="twofa">
          <p>
            <span className="badge badge-paid">{t('twofa.on')}</span>{' '}
            {t('twofa.recoveryLeft', { count: status.recovery_left })}
          </p>
          <p className="muted">{t('twofa.disableDesc')}</p>
          <div className="form-grid">
            <Field label={t('password')} span>
              <input
                className="text-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {codeField(t('twofa.codeOrRecovery'))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {t('twofa.disable')}
            </button>
          </div>
        </form>
      ) : setup ? (
        <form onSubmit={enable} className="twofa">
          <ol className="twofa-steps">
            <li>{t('twofa.step1')}</li>
            <li>
              {t('twofa.step2')}
              <div className="twofa-secret mono" aria-label={t('twofa.secretLabel')}>
                {grouped(setup.secret)}
              </div>
              <a className="link" href={setup.otpauth_url}>
                {t('twofa.openApp')}
              </a>
            </li>
            <li>{t('twofa.step3')}</li>
          </ol>
          <div className="form-grid">{codeField(t('twofa.code'))}</div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setSetup(null)}>
              {t('actions.back', { ns: 'common' })}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {t('twofa.enable')}
            </button>
          </div>
        </form>
      ) : (
        <div className="twofa">
          <p>
            <span className="badge badge-unpaid">{t('twofa.off')}</span> {t('twofa.intro')}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {t('twofa.start')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
