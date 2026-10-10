/**
 * PM2 ecosystem — chạy EduCenterPro production ở chế độ cluster (2 worker).
 *
 * Dùng:  pm2 start ecosystem.config.js --env production
 * Build trước: npm run build (tạo server/dist)
 *
 * Lưu ý: rate-limit và permission cache là in-memory nên tách riêng theo từng
 * worker. RATE_LIMIT_DIVISOR=2 chia quota mỗi worker để tổng toàn cụm đúng max
 * cấu hình. Scale xa hơn (4+ worker hoặc nhiều máy) thì cần đưa rate-limit/cache
 * ra Redis.
 */
module.exports = {
  apps: [
    {
      name: 'educenter-pro',
      // Chạy từ thư mục server để dotenv.config() đọc đúng server/.env
      cwd: './server',
      script: 'dist/index.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        // B2: 2 worker → mỗi worker giữ Map rate-limit riêng nên max cấu hình
        // được chia 2 (tổng toàn cụm vẫn đúng max). Xem middleware/rateLimit.ts.
        RATE_LIMIT_DIVISOR: '2',
      },
    },
  ],
};
