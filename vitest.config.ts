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
      // Same single-instance requirement as `react` above, for the platform-api hook-path tests:
      // the wrapper under test resolves @tanstack/react-query via apps/web/node_modules, and the
      // test's QueryClientProvider must be the SAME module instance or the context lookup fails
      // ("No QueryClient set"). Root node_modules has no copy, so without this the test cannot
      // resolve the import at all.
      '@tanstack/react-query': resolve(__dirname, 'apps/web/node_modules/@tanstack/react-query'),
      // Lets tests vi.mock('@tims/auth/client'): the wrapper's client.ts resolves that specifier
      // via apps/web's workspace dep; the mock must resolve it to the same module id to intercept.
      '@tims/auth/client': resolve(__dirname, 'packages/auth/src/client.ts'),
    },
  },
  test: {
    // Vitest's default is 5 000 ms. That is too tight for THIS suite on a developer machine,
    // and the failure mode is corrosive rather than obvious: a slow-but-correct run reports
    // the same red as a real regression, so every local result becomes untrustworthy exactly
    // when you most need to trust it.
    //
    // Two independent reasons the default does not fit here:
    //   - several suites SPAWN subprocesses (tsx/bash) — ~1.5 s of interpreter startup each,
    //     and `verify-tenant-grants-failure-paths` spawns three in one `it`, so it is
    //     marginal by construction before any load at all;
    //   - the machine is routinely shared. Measured 2026-08-07 with an unrelated desktop app
    //     at 479 % CPU: the same tree that CI passes green went red locally on 5 000 ms
    //     timeouts, in DIFFERENT tests run to run — first `verify-tenant-grants`, then
    //     `update-role-family` and `update-fit-requirements`, which spawn nothing.
    //
    // Raised, not removed: a genuinely hung test still fails, just not a slow correct one.
    // If you are tempted to lower this, read the "never claim a result from a stale run"
    // history first — phantom failures from contention have repeatedly cost more than the
    // extra seconds this buys.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
