import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Gom các page lazy-load thành 4 chunk theo nhóm route.
        // Attendance/Homework dùng chung admin+teacher -> để Rollup tách shared chunk riêng.
        manualChunks(id: string) {
          // Vendor riêng để cache dài hạn, tránh react/react-dom lọt vào chunk route.
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('/features/parent/')) return 'parent';
          if (id.includes('/features/teacher/')) return 'teacher';
          if (id.includes('/features/landing/') || id.includes('/features/auth/')) return 'public';
          if (id.includes('/features/classes/') || id.includes('/features/homework/'))
            return undefined;
          if (id.includes('/features/')) return 'admin';
          return undefined;
        },
      },
    },
  },
});
