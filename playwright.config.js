// E2E tests of the browser build (npm run web): the same interface as the app, with the demo library in memory.
// Edge is the browser — the same Chromium engine as WebView2 in the exe, and no browser download is needed.
import { defineConfig } from '@playwright/test';

const PORT = 5173;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  expect: { timeout: 10_000 },
  webServer: {
    command: 'npm run web',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
