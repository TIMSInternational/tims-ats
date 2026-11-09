import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// TIMS ATS <-> TIMS Assessments (tims-suite /v1), both stacks running locally. See README.md.
// Not part of any CI run: e2e/playwright.config.ts never reaches this directory, and the spec skips
// itself unless ASSESSMENTS_CROSS_STATE names the state file stack/up.sh wrote.
const stateFile = process.env.ASSESSMENTS_CROSS_STATE;
const baseURL = stateFile ? (JSON.parse(readFileSync(stateFile, 'utf8')) as { baseURL: string }).baseURL : undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /cross\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'assessments-cross',
      use: {
        ...devices['Desktop Chrome'],
        ignoreHTTPSErrors: true,
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
  ],
});
