import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from './useDebounce';
import { useSearchParams } from 'react-router-dom';

/**
 * UX-6: giữ page/search/filter trên URL (?search=an&status=paused&page=3) thay vì useState,
 * để Back từ trang chi tiết quay lại đúng trang/bộ lọc, và link lọc gửi được cho người khác.
 *
 *   const [q, setQ] = useUrlState({ search: '', status: '', page: '1' });
 *   const [search, setSearch] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }));
 *   // <input value={search} onChange={(e) => setSearch(e.target.value)} />; fetch theo q.search (đã debounce)
 *   setQ({ status: v, page: '1' });                 // đổi filter thì về trang 1
 *   Number(q.page)
 *
 * - Giá trị luôn là string; key bằng default thì bị xóa khỏi URL (URL gọn).
 * - Giữ nguyên param khác đang có (?tab=...).
 * - Luôn `replace` (gõ phím không đẻ ra 1 mục history mỗi ký tự).
 * - Gộp mọi thay đổi của 1 sự kiện vào MỘT lần gọi setQ (2 lần gọi liền nhau trong cùng tick: lần sau đè lần trước).
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams();
  // defaults thường là object literal mới mỗi render -> chỉ lấy lần đầu
  const defaultsRef = useRef(defaults);

  const state = useMemo(() => {
    const out: Record<string, string> = { ...defaultsRef.current };
    for (const k of Object.keys(out)) {
      const v = params.get(k);
      if (v !== null) out[k] = v;
    }
    return out as T;
  }, [params]);

  const set = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === defaultsRef.current[k]) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  return [state, set];
}

/**
 * B-2: ô tìm kiếm gắn URL. KHÔNG bind thẳng `value={q.search}`: RR7 cập nhật URL trong transition (async) nên
 * input controlled bị React trả về giá trị cũ sau mỗi phím -> nhảy con trỏ về cuối, vỡ IME (Telex).
 * Chữ đang gõ nằm ở state cục bộ; chỉ giá trị đã debounce mới ghi lên URL (`commit`, thường kèm page: '1').
 * URL đổi từ ngoài (Back, nút "Xóa bộ lọc" gọi setQ) thì đồng bộ ngược vào ô.
 */
export function useUrlSearch(
  urlValue: string,
  commit: (v: string) => void,
  delayMs?: number
): [string, (v: string) => void] {
  const [text, setText] = useState(urlValue);
  const debounced = useDebounce(text, delayMs);
  const urlRef = useRef(urlValue);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // Giá trị mình vừa ghi lên URL: khi URL "dội" về đúng giá trị đó thì không ghi đè chữ người dùng đang gõ tiếp.
  const pending = useRef<string | null>(null);

  useEffect(() => {
    urlRef.current = urlValue;
    if (urlValue === pending.current) pending.current = null;
    else setText(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (debounced === urlRef.current) return;
    pending.current = debounced;
    commitRef.current(debounced);
  }, [debounced]);

  return [text, setText];
}
