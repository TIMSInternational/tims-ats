// Config for the reporter integration test only (vitest-json-reporter.test.ts). Its include pattern
// matches nothing the repository's own vitest config runs, so this fixture never joins the real suite.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['*.fixture.ts'],
  },
});
