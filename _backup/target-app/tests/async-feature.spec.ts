import { test, expect, chromium, Browser, Page } from '@playwright/test';

test.describe('비동기 처리 테스트 (Async Testing)', () => {
    let browser: Browser;
    let page: Page;

    test.beforeAll(async () => {
        try {
            browser = await chromium.connectOverCDP('http://localhost:9222', { slowMo: 1000 });
            const context = browser.contexts()[0] || await browser.newContext();
            page = await context.newPage();
        } catch (error) {
            console.error('브라우저 연결 실패!');
            throw error;
        }
    });

    test.afterAll(async () => {
        if (page) await page.close();
        if (browser) await browser.close();
    });

    test('로그인 버튼 클릭 시 로딩 상태를 거쳐 결과가 나와야 한다', async () => {
        await page.goto('http://localhost:5173');

        // 1. 입력
        await page.getByTestId('username-input').fill('testuser');
        await page.getByTestId('password-input').fill('password123');

        // 2. 버튼 클릭
        await page.getByTestId('login-button').click();

        // 3. [검증 A] 클릭 직후, 버튼이 '로그인 중...'으로 바뀌었는지 확인 (즉시 반응 확인)
        // Playwright는 기본적으로 기다려주지만, 여기서는 "즉시" 바뀌었는지가 중요하므로
        // 로딩 상태가 *나타났음*을 검증합니다.
        await expect(page.getByTestId('login-button')).toHaveText('로그인 중...');
        await expect(page.getByTestId('login-button')).toBeDisabled();

        // 4. [검증 B] 2초 후, 로딩이 끝나고 성공 메시지가 뜨는지 확인 (자동 대기)
        // Playwright의 장점: 2초를 명시적으로 sleep(2000) 할 필요가 없습니다.
        // toHaveText가 조건이 만족될 때까지(기본 5초) 자동으로 재시도(polling)하며 기다립니다.
        await expect(page.getByTestId('login-message')).toHaveText('로그인 성공!');

        // 5. 버튼이 다시 원래대로 돌아왔는지 확인
        await expect(page.getByTestId('login-button')).toHaveText('로그인');
        await expect(page.getByTestId('login-button')).toBeEnabled();
    });
});
