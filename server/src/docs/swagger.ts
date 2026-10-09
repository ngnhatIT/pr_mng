import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { logger } from '../shared/logger';
import { env } from '../config/env';

/**
 * Mount Swagger UI tại /api/docs.
 * Đọc spec từ src/docs/openapi.yaml (dev) hoặc dist/docs/openapi.yaml (production).
 * M10: production KHÔNG mount Swagger UI (tránh lộ bề mặt API).
 */
export function setupSwagger(app: Express): void {
  if (env.IS_PROD) {
    logger.warn('[swagger] Production: bỏ qua Swagger UI');
    return;
  }
  const candidates = [
    path.resolve(__dirname, 'openapi.yaml'), // dist/docs/openapi.yaml (production)
    path.resolve(__dirname, '..', 'src', 'docs', 'openapi.yaml'), // src (tsx dev)
  ];
  const specPath = candidates.find((p) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!specPath) {
    logger.warn('[swagger] Không tìm thấy openapi.yaml, bỏ qua Swagger UI');
    return;
  }
  const spec = YAML.load(specPath) as Record<string, unknown>;
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
  logger.info('[swagger] Swagger UI sẵn sàng tại /api/docs');
}
