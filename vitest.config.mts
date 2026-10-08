import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// .mts so Vite loads the config as ESM (no "ESM syntax in a file loaded as CommonJS" warning, QA N8).
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      // 'server-only' throws outside the React server bundle; tests run lib code directly.
      'server-only': path.join(root, 'tests/support/server-only-stub.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
