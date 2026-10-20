import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);

// Starts the API on its own port with the in-memory store, so the browser tests
// need no database and never touch a stack that is already running on 3000.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: 'npx tsx src/server.ts',
    url: `http://127.0.0.1:${port}/health/live`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(port), NODE_ENV: 'development', LOG_LEVEL: 'warn', DATABASE_HOST: '' },
  },
});
