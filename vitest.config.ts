import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source so vi.mock('@tims/...') works
      // reliably without pnpm symlink path mismatches.
      '@tims/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@tims/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@tims/ai': resolve(__dirname, 'packages/ai/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
