import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './playwright-test-results',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'Local Edge',
      use: {
        // 이미 실행된 브라우저(포트 9222)에 연결
        // launch 대신 connect option은 config 레벨이 아닌 test 실행 시 적용되거나,
        // 여기서는 device 설정을 비우고 global setup에서 처리할 수 있으나,
        // 가장 쉬운 방법은 launchOptions를 비우고 connect를 사용하는 것입니다.
        // 하지만 config 파일에서 직접 connectOverCDP를 지정하는 표준 속성은 없습니다.
        // 대신, 아래처럼 실행 시점에 환경 변수나 커스텀 설정을 활용하거나,
        // 간단히 launch command를 override하는 것이 아니라 test 코드 내에서 접속하거나
        // *가장 쉬운 방법*: 프로젝트 설정을 일반 launch로 두되, 사용자가 직접 connect 하도록 가이드하는 것입니다.

        // 하지만 여기서는 Playwright가 기존 브라우저를 "launch" 하는 시도를 막아야 합니다.
        // 안타깝게도 playwright.config.ts의 projects 배열에서는 'connect'를 직접 정의할 수 없습니다.
        // 따라서, launchOptions.executablePath를 사용하는 대신, 
        // globalSetup을 쓰거나 test 파일 내부에서 connectOverCDP를 써야 합니다.

        // *전략 변경*: Config 파일은 그대로 두고, 로컬용 연결 테스트 파일을 별도로 분리하거나
        // 현재 상황에서는 Config를 수정하여 `launch process`를 우회할 수 없습니다.
        // 대신, 브라우저 타입을 'create' 하는게 아니라 webServer만 띄우고
        // 테스트 코드 내부에서 chromium.connectOverCDP를 호출하도록 변경하는 것이 가장 확실합니다.
      },
    }
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
