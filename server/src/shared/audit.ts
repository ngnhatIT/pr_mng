/**
 * Audit log — ghi lại "ai làm gì" cho các thao tác quan trọng,
 * đặc biệt là tiền bạc (hóa đơn, thanh toán) và thao tác xóa.
 *
 * Dùng ở service: gọi audit({...}) sau khi thao tác thành công.
 * Hàm không bao giờ ném lỗi (không để audit làm hỏng nghiệp vụ chính).
 */
import { db } from '../db';
import { logger } from './logger';

const log = logger.scope('audit');

export type AuditAction =
  'create' | 'update' | 'delete' | 'approve' | 'reject' | 'payment' | 'apply_credit' | 'login';

export interface AuditActor {
  id?: number | null;
  name?: string;
  role?: string;
  ip?: string;
}

export interface AuditEntry {
  centerId: number | null;
  actor?: AuditActor;
  action: AuditAction;
  /** Tên bảng/domain: 'invoices' | 'payments' | 'students' | ... */
  entity: string;
  entityId?: number | null;
  /** Mô tả tiếng Việt cho người đọc, vd "Thu 500.000đ cho HD12" */
  summary: string;
  /** Chi tiết thêm (lưu JSON) */
  meta?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (center_id, actor_id, actor_name, actor_role, action, entity, entity_id, summary, meta, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.centerId,
        entry.actor?.id ?? null,
        entry.actor?.name ?? null,
        entry.actor?.role ?? null,
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        entry.summary,
        entry.meta ? JSON.stringify(entry.meta) : null,
        entry.actor?.ip ?? null
      );
  } catch (err) {
    // Audit không được làm hỏng nghiệp vụ chính
    log.error('Ghi audit log thất bại', { error: String(err), entity: entry.entity });
  }
}

/** Dựng actor từ request đã xác thực. */
export function actorFromReq(req: {
  user?: { id?: number; name?: string; username?: string; role?: string } | null;
  ip?: string;
}): AuditActor {
  const u = req.user;
  return {
    id: u?.id ?? null,
    name: u?.name || u?.username || 'Hệ thống',
    role: u?.role,
    ip: req.ip,
  };
}

export function formatVND(n: number): string {
  return `${Number(n).toLocaleString('vi-VN')}đ`;
}
