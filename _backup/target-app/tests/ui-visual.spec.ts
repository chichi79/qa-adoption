import { test, expect, chromium, Browser, Page } from '@playwright/test';

test.describe('UI 시각적 회귀 테스트', () => {
    let browser: Browser;
    let page: Page;

    test.beforeAll(async () => {
        try {
            // 실행 중인 브라우저에 연결 (1초 슬로우 모션)
            browser = await chromium.connectOverCDP('http://localhost:9222', { slowMo: 1000 });
            const context = browser.contexts()[0] || await browser.newContext();
            page = await context.newPage();
        } catch (error) {
            console.error('브라우저 연결 실패! launch-edge-debug.ps1 실행 필요');
            throw error;
        }
    });

    test.afterAll(async () => {
        if (page) await page.close();
        if (browser) await browser.close();
    });

    test('로그인 페이지 디자인이 원본과 일치해야 한다', async () => {
        await page.goto('http://localhost:5173');

        // 페이지 로딩 대기 (충분히 렌더링될 때까지)
        await expect(page.getByText('QA 자동화 테스트 (POC)')).toBeVisible();

        // 📸 스크린샷을 찍어서 기존 '원본(golden image)'과 비교
        // 처음 실행 시에는 비교할 원본이 없으므로, 현재 화면을 원본으로 저장하고 성공 처리됨.
        await expect(page).toHaveScreenshot('login-page.png', {
            maxDiffPixels: 100, // 100픽셀 미만의 차이는 무시 (렌더링 차이 보정)
        });
    });
});
