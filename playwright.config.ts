import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://localhost:8787', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'wrangler dev --ip 127.0.0.1 --port 8787',
    url: 'http://localhost:8787/health',
    timeout: 60_000,
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: '/tmp/drmc-wrangler-config' },
  },
})
