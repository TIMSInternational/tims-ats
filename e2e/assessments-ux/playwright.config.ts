import { defineConfig, devices } from '@playwright/test';

// The assessments UX flow (AS-14 / AS-7): the real apps/web components in a real browser, served by a Vite harness,
// with the C# Platform surface and the TIMS Assessments provider behind it MOCKED at the browser's /api/platform relay.
// Needs no stack (unlike ../playwright.config.ts): run with
//   pnpm --filter @tims/e2e exec playwright test -c assessments-ux/playwright.config.ts
const port = Number(process.env.ASSESSMENTS_UX_PORT ?? 4317);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', locale: 'en-US' },
  projects: [{ name: 'assessments-ux', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: 'node serve.mjs',
    cwd: __dirname,
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
