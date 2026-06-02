import { test, expect, chromium, Browser, Page } from '@playwright/test';

// 기본 'page' fixture 대신 직접 브라우저에 연결하여 생성한 page를 사용
test.describe('로그인 기능 테스트 (기존 브라우저 연결)', () => {
    let browser: Browser;
    let page: Page;

    test.beforeAll(async () => {
        // 1. 이미 실행 중인 Edge 브라우저(포트 9222)에 연결
        try {
            // slowMo: 1000 -> 동작 하나하나를 1초씩 천천히 보여줌 (관찰용)
            browser = await chromium.connectOverCDP('http://localhost:9222', { slowMo: 1000 });
            const context = browser.contexts()[0] || await browser.newContext();
            page = await context.newPage();
        } catch (error) {
            console.error('브라우저 연결 실패! launch-edge-debug.ps1 스크립트를 먼저 실행해주세요.');
            throw error;
        }
    });

    test.afterAll(async () => {
        // 연결 해제 (브라우저는 닫지 않음)
        if (page) await page.close();
        if (browser) await browser.close();
    });

    test.beforeEach(async () => {
        // 2. 페이지 접속 (로컬 개발 서버 주소)
        if (page) await page.goto('http://localhost:5173');
    });

    test('유효한 계정으로 로그인 성공 시 환영 메시지가 표시되어야 한다', async () => {
        // page 객체 사용
        await expect(page.getByText('QA 자동화 테스트 (POC)')).toBeVisible();

        await page.getByTestId('username-input').fill('testuser');
        await page.getByTestId('password-input').fill('password123');

        await page.getByTestId('login-button').click();

        await expect(page.getByTestId('login-message')).toHaveText('로그인 성공!');
    });

    test('잘못된 비밀번호 입력 시 에러 메시지가 표시되어야 한다', async () => {
        await page.getByTestId('username-input').fill('testuser');
        await page.getByTestId('password-input').fill('wrongpassword');

        await page.getByTestId('login-button').click();

        await expect(page.getByTestId('login-message')).toHaveText('아이디 또는 비밀번호가 잘못되었습니다.');
    });
});
