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
      // Same pnpm symlink-path mismatch as above: a test at repo root and
      // packages/api/src/lib/cv-extraction.ts otherwise resolve 'pdf-parse'/'mammoth'
      // through different symlink chains into the pnpm store, so vi.mock() in the
      // test doesn't intercept the import the source file makes. Force both to the
      // same resolved path.
      'pdf-parse': resolve(__dirname, 'packages/api/node_modules/pdf-parse'),
      mammoth: resolve(__dirname, 'packages/api/node_modules/mammoth'),
      // Same pnpm symlink-path mismatch, for the DEI report-generation tests (tests/dei/
      // report-generation.test.ts), which import exceljs directly to read back the xlsx
      // buffer produced by packages/api/src/services/dei-report-builder.ts.
      exceljs: resolve(__dirname, 'packages/api/node_modules/exceljs'),
      // Same fix, pre-applied for the CV-upload plan's S3 library (packages/api/src/lib/s3.ts)
      // and its tests, which hit the identical mismatch for these two packages.
      '@aws-sdk/client-s3': resolve(__dirname, 'packages/api/node_modules/@aws-sdk/client-s3'),
      '@aws-sdk/s3-presigned-post': resolve(__dirname, 'packages/api/node_modules/@aws-sdk/s3-presigned-post'),
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
