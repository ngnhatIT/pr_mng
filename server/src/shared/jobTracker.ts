/**
 * Theo dõi các job cron đang chạy để graceful shutdown có thể chờ xong
 * (có timeout), thay vì process.exit cắt ngang giữa chừng.
 */
const activeJobs = new Set<Promise<unknown>>();

/**
 * Bọc promise của 1 lần chạy cron: thêm vào set, tự gỡ khi xong
 * (dù thành công hay thất bại). Trả về promise gốc để caller dùng tiếp.
 */
export function trackJob<T>(p: Promise<T>): Promise<T> {
  activeJobs.add(p);
  // Dùng then 2 nhánh thay cho finally: derived promise luôn resolve nên
  // không gây unhandledRejection khi job gốc reject.
  const cleanup = (): void => {
    activeJobs.delete(p);
  };
  p.then(cleanup, cleanup);
  return p;
}

/**
 * Chờ mọi job đang chạy xong, tối đa timeoutMs (mặc định 30s).
 * Snapshot tại lúc gọi — scheduler đã stop nên không có job mới phát sinh.
 */
export async function waitForJobs(timeoutMs = 30000): Promise<void> {
  await Promise.race([
    Promise.allSettled([...activeJobs]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
