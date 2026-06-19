// eslint.config.mjs — ESLint v10 flat config for tabularium (CJS project)
// Carthago delenda est — quality gate must pass: 0 errors, <=10 warnings
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // MCP server uses console.error (stderr) as standard logging — false positive
      'no-console': 'off',
      // Codebase will be progressively cleaned — temporary
      '@typescript-eslint/no-unused-vars': 'off',
      // CommonJS dynamic require() in TS files (e.g. better-sqlite3, node:module)
      '@typescript-eslint/no-require-imports': 'off',
      // Error cause chain — enable to ensure original errors are preserved as cause
      'preserve-caught-error': 'error',
      // Catch bugs from constant binary expressions
      'no-constant-binary-expression': 'error',
      // Useful rules — keep active
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': 'warn',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '**/*.cjs',
      '_verify_migration.js',
      'benchmarks/**',
      'test-mcp.mjs',
      'jest.config.js',
    ],
  },
);
