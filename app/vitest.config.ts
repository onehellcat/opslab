import { defineConfig } from 'vitest/config';

// API tests only. Browser tests in e2e/ run with Playwright (npm run test:e2e).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
