import { test, expect } from '@playwright/test';

test.describe('로그인 기능 테스트', () => {

    test.beforeEach(async ({ page }) => {
        // 1. 페이지 접속 (로컬 개발 서버 주소)
        await page.goto('http://localhost:5173');
    });

    test('유효한 계정으로 로그인 성공 시 환영 메시지가 표시되어야 한다', async ({ page }) => {
        // 2. 타이틀 확인
        await expect(page.getByText('QA 자동화 테스트 (POC)')).toBeVisible();

        // 3. 아이디/비밀번호 입력
        await page.getByTestId('username-input').fill('testuser');
        await page.getByTestId('password-input').fill('password123');

        // 4. 로그인 버튼 클릭
        await page.getByTestId('login-button').click();

        // 5. 결과 검증
        await expect(page.getByTestId('login-message')).toHaveText('로그인 성공!');
    });

    test('잘못된 비밀번호 입력 시 에러 메시지가 표시되어야 한다', async ({ page }) => {
        // 3. 아이디/비밀번호 입력 (틀린 비밀번호)
        await page.getByTestId('username-input').fill('testuser');
        await page.getByTestId('password-input').fill('wrongpassword');

        // 4. 로그인 버튼 클릭
        await page.getByTestId('login-button').click();

        // 5. 결과 검증
        await expect(page.getByTestId('login-message')).toHaveText('아이디 또는 비밀번호가 잘못되었습니다.');
    });
});
