import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface LoadState<T> {
  /** Dữ liệu lần tải thành công gần nhất (giữ nguyên trong lúc tải lại để bảng chỉ mờ đi, không nháy skeleton). */
  data: T | undefined;
  loading: boolean;
  /** Lỗi của lần tải gần nhất (null nếu thành công). */
  error: unknown;
  /** Tải lại với deps hiện tại (sau thêm/sửa/xóa, hoặc nút "Thử lại"). */
  reload: () => void;
  /** Sửa data tại chỗ (cập nhật lạc quan) mà không gọi lại API. */
  setData: (update: (prev: T | undefined) => T | undefined) => void;
}

/**
 * UX-5: tải dữ liệu cho trang, bỏ qua response cũ về muộn (gõ "an" rồi "anh": kết quả "an" về sau không đè).
 * Mỗi lần deps đổi / reload(), request trước bị abort (signal truyền cho fetcher nếu muốn hủy fetch thật).
 *
 *   const { data, loading, error, reload } = useLoad(() => studentsApi.list({ search, page }), [search, page]);
 *   loading && !data ? <TableSkeleton/> : error && !data ? <LoadError onRetry={reload}/> : ...
 */
export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: DependencyList): LoadState<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: undefined,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const ac = new AbortController();
    setState((s) => (s.loading && s.error === null ? s : { ...s, loading: true, error: null }));
    fetcherRef.current(ac.signal).then(
      (data) => {
        if (!ac.signal.aborted) setState({ data, loading: false, error: null });
      },
      (error: unknown) => {
        if (!ac.signal.aborted) setState((s) => ({ data: s.data, loading: false, error }));
      }
    );
    return () => ac.abort();
    // deps do caller khai báo (giống useEffect); fetcher đọc qua ref nên không cần nằm trong deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback(
    (update: (prev: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: update(s.data) })),
    []
  );
  return { ...state, reload, setData };
}
