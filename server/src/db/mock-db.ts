/**
 * Mock db layer cho unit test KHÔNG cần PostgreSQL.
 * CHỈ dùng trong *.test.ts — không import ở code production.
 *
 * Cách dùng:
 *   const restore = installMockDb(routes); // beforeEach
 *   ... gọi service như bình thường ...
 *   restore(); // after — trả lại db thật
 *
 * - Route khớp theo chuỗi con SQL (route cụ thể đặt TRƯỚC route chung).
 * - SQL nào chưa có route sẽ throw ngay để lộ mock thiếu, thay vì trả undefined lặng lẽ.
 * - transaction được ghép nối (serialize): mô phỏng SELECT ... FOR UPDATE trên PG thật,
 *   2 transaction đồng thời chạy tuần tự, transaction sau thấy dữ liệu transaction trước đã commit.
 */
import { db } from './pg-compat';
import type { RunResult, Statement, Tx } from './pg-compat';

export interface MockRoute {
  /** Nhận diện SQL: chuỗi con (khớp chính xác thứ tự) hoặc RegExp. */
  match: string | RegExp;
  get?: (params: unknown[]) => unknown;
  all?: (params: unknown[]) => unknown[];
  run?: (params: unknown[]) => RunResult | void;
}

/** Cài mock lên object db dùng chung; trả về hàm restore. */
export function installMockDb(routes: MockRoute[]): () => void {
  const realPrepare = db.prepare;
  const realTransaction = db.transaction;

  const findRoute = (sql: string): MockRoute => {
    const r = routes.find((x) =>
      typeof x.match === 'string' ? sql.includes(x.match) : x.match.test(sql)
    );
    if (!r) throw new Error(`[mock-db] SQL chưa được mock: ${sql}`);
    return r;
  };
  const makeStmt = (sql: string): Statement => {
    const route = findRoute(sql);
    return {
      get: async (...p: unknown[]) => route.get?.(p),
      all: async (...p: unknown[]) => route.all?.(p) ?? [],
      run: async (...p: unknown[]) =>
        route.run?.(p) ?? { changes: 0, lastInsertRowid: undefined },
    };
  };

  db.prepare = (sql: string) => makeStmt(sql);
  // Ghép nối transaction để mô phỏng row lock: tx sau thấy commit của tx trước
  let tail: Promise<unknown> = Promise.resolve();
  db.transaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx: Tx = { prepare: (sql: string) => makeStmt(sql), exec: async () => undefined };
    const run: Promise<T> = tail.then(() => fn(tx));
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return () => {
    db.prepare = realPrepare;
    db.transaction = realTransaction;
  };
}
