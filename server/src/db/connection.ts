/**
 * Giữ file connection.ts để mọi import hiện tại (`from '../db/connection'`)
 * không phải sửa. Triển khai thực tế nằm ở pg-compat.ts (PostgreSQL).
 */
export { db, closePool } from './pg-compat';
export type { Db, Tx, Statement, RunResult } from './pg-compat';
