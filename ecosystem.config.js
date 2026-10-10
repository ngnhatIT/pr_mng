/**
 * PM2 ecosystem — chạy EduCenterPro production ở chế độ cluster (2 worker).
 *
 * Dùng:  pm2 start ecosystem.config.js --env production
 * Build trước: npm run build (tạo server/dist)
 *
 * Lưu ý: rate-limit và permission cache là in-memory nên tách riêng theo từng
 * worker. Ở 2 worker điều này chấp nhận được; scale xa hơn (4+ worker hoặc
 * nhiều máy) thì cần đưa rate-limit/cache ra Redis.
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
      },
    },
  ],
};
