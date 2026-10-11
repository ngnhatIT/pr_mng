import { useEffect, useState } from 'react';
import { getToken, tryRefresh } from '../api/client';

/** fetch kèm Bearer token; 401 (token 15 phút đã hết) -> refresh 1 lần rồi thử lại (CORR-7). */
export async function fetchWithAuth(url: string): Promise<Response> {
  const go = () => {
    const token = getToken();
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  };
  const res = await go();
  return res.status === 401 && (await tryRefresh()) ? go() : res;
}

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
    fetchWithAuth(url)
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
