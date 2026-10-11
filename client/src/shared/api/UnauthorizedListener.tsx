import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../ui/toast';

/**
 * Lắng nghe sự kiện 'edu:unauthorized' do api() phát khi gặp 401:
 * toast thông báo + navigate mềm về trang login (không reload toàn trang).
 * Phải đặt trong router (Root của App) và <ToastProvider>.
 */
export function UnauthorizedListener() {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation('common');

  useEffect(() => {
    const handler = (e: Event) => {
      const loginPath = (e as CustomEvent<{ loginPath?: string }>).detail?.loginPath || '/login';
      toast(t('api.sessionExpired'), 'error');
      void navigate(loginPath, { replace: true });
    };
    window.addEventListener('edu:unauthorized', handler);
    return () => window.removeEventListener('edu:unauthorized', handler);
  }, [navigate, toast, t]);

  return null;
}
