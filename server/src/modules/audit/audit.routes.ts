import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { v, validate } from '../../shared/validate';
import * as auditService from './audit.service';

const router = Router();

/**
 * Nhật ký hoạt động — chỉ admin xem.
 * GET /api/audit-logs?action=payment&entity=invoices&from=2026-01-01&to=2026-12-31&page=1&limit=20
 */
router.get(
  '/',
  requirePermission('audit.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const q = validate(req.query, {
      action: v.string({ label: 'Hành động' }),
      entity: v.string({ label: 'Đối tượng' }),
      from: v.string({ label: 'Từ ngày' }),
      to: v.string({ label: 'Đến ngày' }),
      page: v.string({ label: 'Trang' }),
      limit: v.string({ label: 'Số dòng' }),
    });
    res.json(
      await auditService.listAuditLogs(
        reqCenterId(req),
        { action: q.action, entity: q.entity, from: q.from, to: q.to },
        { page: q.page, limit: q.limit }
      )
    );
  })
);

export default router;
