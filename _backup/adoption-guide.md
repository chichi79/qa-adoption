# 기존 프로젝트 QA 자동화 도입 가이드 (실전편)

기존 레거시 프로젝트(특히 UI 개편 예정)에 Playwright를 안전하게 이식하기 위한 단계별 절차입니다.

## 1. 설치 및 환경 구성 (Setup)

가장 먼저 프로젝트 루트에서 Playwright를 설치하고, 우리가 검증한 **"CDP 연결 환경"**을 세팅해야 합니다.

1.  **패키지 설치**:
    ```bash
    npm init playwright@latest
    # 설치 시 질문:
    # - TypeScript 사용? Yes
    # - tests 폴더 위치? tests (또는 e2e)
    # - GitHub Actions? (상황에 따라 선택, 로컬 전용이면 No)
    # - 브라우저 설치? Yes (하지만 실행은 CDP로 할 예정)
    ```

2.  **보안 우회 스크립트 이식**:
    *   POC에서 사용한 `launch-edge-debug.ps1` 파일을 프로젝트 루트로 복사합니다.
    *   `.gitignore` 파일에 `test-results/` 등이 포함되어 있는지 확인합니다.

## 2. 테스트 코드 작성 (Smoke Test)

거창한 테스트 대신, **"페이지가 안 죽고 뜨는지"** 확인하는 간단한 테스트(Smoke Test) 하나만 먼저 작성합니다.

*   `tests/home.spec.ts` (예시):
    ```typescript
    import { test, expect, chromium } from '@playwright/test';

    test('메인 페이지 로드 확인', async () => {
      // 보안 우회 연결
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      const page = await browser.contexts()[0].newPage();

      // 로컬 개발 서버 접속
      await page.goto('http://localhost:3000'); // 포트 확인 필요

      // 타이틀이나 핵심 요소 확인
      await expect(page).toHaveTitle(/My Project/);
    });
    ```

## 3. UI 개편 대비 전략 (Critical!)

UI가 대대적으로 바뀔 예정이라면 **`data-testid`** 속성 작업이 가장 시급합니다.

1.  ** 핵심 시나리오 선정**: (예: 로그인 -> 상품 목록 -> 상세 페이지)
2.  **ID 심기**:
    *   기존 코드(`OldComponent.tsx`)에 `data-testid="login-btn"`을 추가합니다.
    *   **중요**: 앞으로 만들 새 코드(`NewComponent.tsx`)에도 똑같은 ID `data-testid="login-btn"`을 유지해야 합니다.
3.  **테스트 작성**:
    *   CSS 클래스나 태그 구조(`div > span`)가 아닌, 오직 `getByTestId('login-btn')`만 사용하는 테스트 코드를 짭니다.

## 4. 실행 프로세스 (Work Cycle)

1.  개발 서버 실행 (`npm run dev`)
2.  브라우저 디버그 모드 실행 (`./launch-edge-debug.ps1`)
3.  테스트 실행 (`npx playwright test`)

---
**Tip**: 팀원들에게는 "이 스크립트만 실행하면 복잡한 설정 없이 바로 테스트 돌려볼 수 있다"고 공유하면 도입 저항감을 줄일 수 있습니다.
