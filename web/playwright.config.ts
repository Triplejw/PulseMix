import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:8080';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1100 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
