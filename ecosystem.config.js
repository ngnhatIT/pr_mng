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
      // config/env.ts luôn nạp server/.env theo đường dẫn tuyệt đối; cwd server để
      // ./backups, log... nằm trong server/.
      cwd: './server',
      script: 'dist/index.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      // OPS-3: graceful shutdown trong index.ts chờ job tối đa 30s + force timer 35s —
      // PM2 mặc định SIGKILL sau 1.6s. 40s > 35s để shutdown kịp chạy hết.
      kill_timeout: 40000,
      // Worker gửi process.send('ready') sau khi listen; reload chỉ tắt worker cũ khi
      // worker mới đã sẵn sàng. initDatabase có thể chờ advisory lock của worker kia.
      wait_ready: true,
      listen_timeout: 60000,
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
