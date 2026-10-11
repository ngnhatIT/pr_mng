/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Id bản build: main.tsx đăng ký /sw.js?v=<id> -> mỗi lần deploy SW có URL mới, cài lại và xóa cache cũ.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      // File upload do Express phục vụ ở /uploads/:filename (OPS-2)
      '/uploads': 'http://localhost:4000',
    },
  },
  test: {
    // Mặc định môi trường node; test cần DOM tự khai báo `// @vitest-environment happy-dom` đầu file.
    setupFiles: ['./src/test-setup.ts'],
    // B3-5/B4-7: `npm run test:coverage` (CI chạy). Ngưỡng đặt sát dưới số hiện tại -> coverage không được tụt;
    // thêm test thì nâng ngưỡng theo.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/test-utils.tsx'],
      reporter: ['text-summary'],
      thresholds: { lines: 37, statements: 36, branches: 33, functions: 31 },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // PERF-1: chỉ tách vendor (cache dài hạn). KHÔNG gom src/features/* vào manual chunk: Rollup kéo luôn
        // các dep dùng chung (i18n, api client, toast...) vào chunk đó và entry phải import tĩnh nó
        // => trang nào cũng tải code landing/admin. Để Rollup tự tách theo từng route lazy.
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
