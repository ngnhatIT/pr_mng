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
        projectService: false,
      },
    },
    rules: {
      // Cho phép any có chủ đích (codebase dùng nhiều unknown/any khi đọc DB)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Không để console.log lọt vào code (dùng logger)
      'no-console': 'error',
      // Prefer const
      'prefer-const': 'error',
    },
  },
  {
    // Test files: nới lỏng một số rule
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'client/dist/**',
      'server/dist/**',
    ],
  }
);
