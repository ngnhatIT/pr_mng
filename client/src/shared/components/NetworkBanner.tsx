import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Banner trạng thái mạng toàn app.
 * Hiện khi offline; tự ẩn khi mạng quay lại (kèm thông báo đã kết nối lại).
 */
export function NetworkBanner() {
  const { t } = useTranslation('common');
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      setWasOffline(true);
      // Ẩn thông báo "đã kết nối lại" sau 3s
      setTimeout(() => setWasOffline(false), 3000);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online && !wasOffline) return null;
  return (
    <div className={`network-banner${online ? ' online' : ' offline'}`} role="status" aria-live="polite">
      {online ? t('network.backOnline') : t('network.offline')}
    </div>
  );
}
