import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Cho phép any có chủ đích (codebase dùng nhiều unknown/any khi đọc DB)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Không để console.log lọt vào code (dùng logger)
      'no-console': 'error',
      // Prefer const
      'prefer-const': 'error',
      // CẤM promise trôi nổi: root cause của ~40 lỗi IDOR/res.json({})/unhandled rejection (audit 2026-10-09)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    // ARCH-3: route chỉ parse HTTP + validate + gọi service — SQL nằm trong *.service.ts.
    // Cấm lấy handle `db` (hàm tiện ích ngày/settings của module db vẫn dùng được).
    files: ['server/src/**/*.routes.ts'],
    // Ngoại lệ duy nhất:
    ignores: [
      'server/src/modules/metrics/metrics.routes.ts', // infra: chỉ đọc pg size/pool stats
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../../db',
              importNames: ['db'],
              message: 'Route không truy vấn DB trực tiếp — chuyển SQL vào <module>.service.ts (ARCH-3).',
            },
          ],
          patterns: [
            {
              group: ['**/db/pg-compat', '**/db/connection'],
              message: 'Route không truy vấn DB trực tiếp — chuyển SQL vào <module>.service.ts (ARCH-3).',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files: nới lỏng một số rule (không cần type-aware lint)
    files: ['**/*.test.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', 'client/dist/**', 'server/dist/**'],
  }
);
