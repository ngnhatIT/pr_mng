import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { logger } from '../shared/logger';
import { env } from '../config/env';

/**
 * Mount Swagger UI tại /api/docs.
 * Đọc spec từ src/docs/openapi.yaml (dev) hoặc dist/docs/openapi.yaml (production).
 * M10: production KHÔNG mount Swagger UI (tránh lộ bề mặt API).
 * OPS-7: swagger-ui-express/yamljs là devDependencies, chỉ require khi không phải
 * production — bản cài `npm ci --omit=dev` không kéo yamljs (không còn bảo trì).
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
  const specPath = candidates.find((p) => fs.existsSync(p));
  if (!specPath) {
    logger.warn('[swagger] Không tìm thấy openapi.yaml, bỏ qua Swagger UI');
    return;
  }
  let swaggerUi: typeof import('swagger-ui-express');
  let YAML: typeof import('yamljs');
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    swaggerUi = require('swagger-ui-express');
    YAML = require('yamljs');
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    logger.warn('[swagger] Chưa cài swagger-ui-express/yamljs (devDependencies), bỏ qua Swagger UI');
    return;
  }
  const spec = YAML.load(specPath) as Record<string, unknown>;
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
  logger.info('[swagger] Swagger UI sẵn sàng tại /api/docs');
}
