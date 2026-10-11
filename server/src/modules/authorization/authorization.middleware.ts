/**
 * Middleware phân quyền dựa trên permission (thay cho role cứng).
 *
 * Cách dùng:
 *   router.get('/', requireAuth, requirePermission('students.view'), handler);
 *   router.delete('/:id', requireAuth, requirePermission('students.delete'), handler);
 *
 * Với scope (S-3: mặc định 'center' — fail-closed):
 *   requirePermission('classes.view', 'own') — CHỈ truyền 'own' khi handler thật sự lọc theo scope own
 *   (ownScoped/scopeFor/getPermissionScope). Route không lọc own mà để 'own' thì custom role scope own
 *   sẽ thấy dữ liệu toàn trung tâm.
 *
 * Khác với requireRole cũ:
 * - Không cần biết user là role gì, chỉ cần có permission
 * - Admin có thể tạo custom role và gán quyền qua UI mà không sửa code
 * - Dễ audit: mọi API khai báo rõ cần quyền gì
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { hasPermission, Scope, invalidateUserPermissions } from './authorization.service';

export function requirePermission(permissionCode: string, minScope: Scope = 'center') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Thiếu token đăng nhập', code: 'UNAUTHORIZED' });
      return;
    }
    try {
      const ok = await hasPermission(req.user, permissionCode, minScope);
      if (!ok) {
        res.status(403).json({
          error: 'Không có quyền thực hiện',
          code: 'FORBIDDEN',
          required: permissionCode,
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: 'Lỗi kiểm tra quyền hạn', code: 'INTERNAL_ERROR' });
    }
  };
}

/** Lấy scope của user cho permission — dùng trong handler cần logic theo scope. */

export { invalidateUserPermissions };
