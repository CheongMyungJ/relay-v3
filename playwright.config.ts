import { defineConfig } from '@playwright/test'

// [스모크] (docs/m2-modules.md 0절, 5절). 빌드한 앱(out/)을 Playwright _electron으로 띄운다.
// Linux에서 화면이 없으면 xvfb-run -a npm run test:smoke. npm test에는 넣지 않는다.
export default defineConfig({
  testDir: 'test/smoke',
  timeout: 90_000,
  retries: 0,
  // 앱 하나씩 띄운다
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
