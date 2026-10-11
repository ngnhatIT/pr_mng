import { useNavigate } from 'react-router-dom';

/**
 * Nút "Quay lại" ở trang chi tiết: có lịch sử trong app thì lùi 1 bước, vào thẳng bằng URL thì về trang danh sách.
 * react-router lưu idx trong history.state; idx = 0 nghĩa là vào thẳng bằng URL.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) void navigate(-1);
    else void navigate(fallback, { replace: true });
  };
}
