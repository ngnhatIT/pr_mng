import { AuthRequest, reqCenterId } from '../middleware/auth';
import { getPermissionScope } from '../modules/authorization/authorization.service';

/**
 * Bối cảnh phân quyền theo trung tâm, dùng chung cho các module nghiệp vụ.
 * centerId = null nghĩa là superadmin (thấy mọi trung tâm).
 */
export interface ScopeCtx {
  centerId: number | null; // null = superadmin (thấy mọi trung tâm)
  role: string;
  teacherId: number | null;
  /**
   * True khi permission scope của user là 'own' (giáo viên hoặc custom role
   * gán scope own): service chỉ trả dữ liệu của lớp mình dạy. teacherId null
   * thì không khớp lớp nào (fail-closed, không fallback thấy tất cả).
   */
  ownOnly?: boolean;
}

/** Dựng ScopeCtx từ request đã xác thực (thay 4 bản copy ở các routes). */
export function scopeOf(req: AuthRequest): ScopeCtx {
  return {
    centerId: reqCenterId(req),
    role: req.user?.role || '',
    teacherId: req.user?.teacher_id ?? null,
  };
}

/**
 * True khi user chỉ có scope 'own' cho permission này (giáo viên hoặc custom
 * role gán scope own): chỉ thấy dữ liệu của lớp mình dạy.
 * Scope 'center'/'all' (staff, admin, superadmin) → false, thấy toàn trung tâm.
 */
export async function ownScoped(req: AuthRequest, permission: string): Promise<boolean> {
  if (!req.user) return false;
  return (await getPermissionScope(req.user.id, permission)) === 'own';
}
