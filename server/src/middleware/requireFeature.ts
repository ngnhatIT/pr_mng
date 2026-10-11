import { Response, NextFunction } from 'express';
import { AuthRequest, reqCenterId } from './auth';
import { db } from '../db';
import { hasFeature, type Center } from '../utils/plans';

/**
 * Chặn API theo gói cước (feature flag).
 * Ví dụ: requireFeature('zalo_auto') — trung tâm gói basic không gọi được API Zalo.
 */
export function requireFeature(featureKey: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const cid = reqCenterId(req);
    if (cid === null || req.user?.role === 'superadmin') {
      // Superadmin (kể cả khi đang chọn 1 trung tâm): không bị giới hạn gói
      next();
      return;
    }
    const center = (await db.prepare('SELECT * FROM centers WHERE id = ?').get(cid)) as Center | undefined;
    if (!hasFeature(center, featureKey)) {
      res.status(403).json({
        error: 'Tính năng này không có trong gói cước của trung tâm. Vui lòng nâng cấp gói.',
        code: 'FEATURE_NOT_INCLUDED',
      });
      return;
    }
    next();
  };
}
