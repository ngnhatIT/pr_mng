import { AuthRequest, reqCenterId } from '../middleware/auth';

/**
 * Bối cảnh phân quyền theo trung tâm, dùng chung cho các module nghiệp vụ.
 * centerId = null nghĩa là superadmin (thấy mọi trung tâm).
 */
export interface ScopeCtx {
  centerId: number | null; // null = superadmin (thấy mọi trung tâm)
  role: string;
  teacherId: number | null;
}

/** Dựng ScopeCtx từ request đã xác thực (thay 4 bản copy ở các routes). */
export function scopeOf(req: AuthRequest): ScopeCtx {
  return {
    centerId: reqCenterId(req),
    role: req.user?.role || '',
    teacherId: req.user?.teacher_id ?? null,
  };
}
