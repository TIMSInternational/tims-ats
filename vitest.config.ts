import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source so vi.mock('@tims/...') works
      // reliably without pnpm symlink path mismatches.
      '@tims/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@tims/api': resolve(__dirname, 'packages/api/src/root.ts'),
      '@tims/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@tims/ai': resolve(__dirname, 'packages/ai/src/index.ts'),
      // Allow tests to import @trpc/server (hosted under packages/api's node_modules via pnpm)
      '@trpc/server': resolve(__dirname, 'packages/api/node_modules/@trpc/server'),
      // Allow tests to import @prisma/client directly (e.g. Prisma.PrismaClientKnownRequestError
      // for P2002 error-shaped mocks), hosted under packages/api's node_modules via pnpm.
      '@prisma/client': resolve(__dirname, 'packages/api/node_modules/@prisma/client'),
      // `import 'server-only'` throws when imported outside the Next.js server bundler
      // (its default export is a hard `throw`). Alias it to an empty module so the
      // pure, unit-testable core of server-only helpers can be imported under vitest.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
      // Allow component tests to resolve React from apps/web
      react: resolve(__dirname, 'apps/web/node_modules/react'),
      'react/jsx-dev-runtime': resolve(__dirname, 'apps/web/node_modules/react/jsx-dev-runtime'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: { label: 'node', color: 'green' },
          environment: 'node',
          include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: { label: 'web-components', color: 'magenta' },
          environment: 'happy-dom',
          include: ['tests/**/*.test.tsx'],
          setupFiles: ['./tests/setup/component-test-setup.ts'],
          // Node v25.9.0's --experimental-webstorage defines a native globalThis.localStorage
          // stub by default that shadows happy-dom's real window.localStorage even under this
          // correctly-configured project (confirmed by direct reproduction). Disabling it here
          // ensures happy-dom's own implementation is what test code actually gets.
          execArgv: ['--no-experimental-webstorage'],
        },
      },
    ],
  },
});
