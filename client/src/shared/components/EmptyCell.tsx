/**
 * Dấu gạch ngang cho ô dữ liệu trống: luôn hiển thị muted nhất quán
 * thay vì mỗi chỗ một kiểu (có chỗ đậm, có chỗ mờ).
 */
export function EmptyCell() {
  return (
    <span className="empty-cell" aria-hidden="true">
      -
    </span>
  );
}
