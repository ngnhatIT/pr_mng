import { useEffect, useState } from 'react';
import { getToken } from '../api/client';

/**
 * Tải file từ URL tương đối bằng fetch + Authorization header,
 * trả về blob URL để dùng cho <img src> / <a href>.
 *
 * Không gắn JWT vào query string (tránh lọt vào browser history,
 * server access log và header Referer). Revoke blob URL khi unmount.
 */
export function useSecureFileUrl(url: string | null): string {
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    if (!url) {
      setBlobUrl('');
      return;
    }
    let alive = true;
    let objUrl = '';
    const token = getToken();
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        if (!alive) return;
        objUrl = URL.createObjectURL(b);
        setBlobUrl(objUrl);
      })
      .catch(() => {
        /* giữ nguyên blobUrl rỗng */
      });
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [url]);

  return blobUrl;
}
