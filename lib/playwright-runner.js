const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const RESULTS_DIR = path.join(__dirname, '..', 'test-results');

// 기본 동작: 이미 띄워 둔 Edge 디버깅 세션(CDP)에 먼저 연결합니다.
// - PowerShell에서 ".\\launch-edge-debug.ps1" 실행 후 사용하세요.
// - CDP 주소는 환경변수 PLAYWRIGHT_CDP_URL 로 변경 가능 (기본: http://localhost:9222)
const DEFAULT_CDP_URL = 'http://localhost:9222';
const CDP_TIMEOUT = 15000;

function getConnectionErrorHint(cdpUrl, err) {
  const msg = err && err.message ? err.message : String(err);
  if (/ECONNREFUSED|connect|ENOTFOUND|timeout/i.test(msg)) {
    return `CDP 연결 실패 (${cdpUrl}). Edge 디버깅 모드가 떠 있는지 확인하세요. PowerShell에서 ".\\launch-edge-debug.ps1" 실행 후 다시 시도하세요. (원인: ${msg})`;
  }
  return msg;
}

/** Windows/파일시스템에서 사용 가능한 파일명으로 정규화 (:, \\, / 등 제거) */
function safeFileName(name) {
  if (name == null || typeof name !== 'string') return 'screenshot';
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '-').trim();
  return sanitized.slice(0, 100) || 'screenshot';
}

// testId > selector > text 순 (selector가 있으면 크롤 시 수집한 요소를 우선 사용해 타임아웃 감소)
function getLocator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.selector) return page.locator(step.selector);
  // 텍스트만 있을 때: 부분 일치(정규식). 긴 텍스트(뉴스 제목 등)는 앞 80자만 사용해 복귀 후 DOM 차이·잘림에 강하게
  if (step.text) {
    const raw = String(step.text).trim();
    const patternText = raw.length > 80 ? raw.substring(0, 80).trim() : raw;
    const namePattern = patternText ? new RegExp(patternText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /./;
    return page
      .getByRole('button', { name: namePattern })
      .or(page.getByRole('link', { name: namePattern }))
      .or(page.getByRole('menuitem', { name: namePattern }))
      .first();
  }
  throw new Error(`step에 testId, text, selector 중 하나가 필요합니다: ${JSON.stringify(step)}`);
}

async function runPlaywright({ baseURL, steps = [] }) {
  const resultsDir = path.join(RESULTS_DIR, `run-${Date.now()}`);
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const cdpUrl = process.env.PLAYWRIGHT_CDP_URL || DEFAULT_CDP_URL;
  let browser;
  try {
    // 기본: Edge 디버깅 모드(CDP)에 연결해서 사용
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: CDP_TIMEOUT });
  } catch (err) {
    const hint = getConnectionErrorHint(cdpUrl, err);
    return {
      duration: 0,
      screenshots: [],
      resultsDir,
      error: hint,
      passed: false,
    };
  }

  // 테스트용 새 컨텍스트 사용 (뷰포트 고정, 기존 탭 상태와 분리)
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const screenshots = [];
  const start = Date.now();
  let lastError = null;
  const stepResults = [];

  // 새 창은 about:blank 로 열리므로, 첫 스텝이 goto가 아니면 맨 앞에 페이지 이동 추가
  const stepsToRun =
    steps.length > 0 && steps[0].action !== 'goto' && baseURL
      ? [{ action: 'goto', url: baseURL, description: '페이지 이동' }, ...steps]
      : steps;

  const STEP_TIMEOUT = 15000; // fill/click 대기 (SPA 렌더링 고려)
  let originURL = baseURL || ''; // 타임아웃 시 재시도 전 처음 페이지로 복귀할 URL

  /** 한 스텝만 실행 (재시도 시 동일 로직 사용). step/stepResult를 인자로 받아 클로저 의존 제거 */
  async function runOneStep(currentStep, currentStepResult) {
    if (currentStep.action === 'goto') {
      const url = currentStep.url || baseURL;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(800);
      originURL = url; // 처음 크롤링한 페이지 기억
    } else if (currentStep.action === 'screenshot') {
      const rawName = currentStep.name || `screenshot-${screenshots.length + 1}`;
      const name = safeFileName(rawName);
      const filePath = path.join(resultsDir, `${name}.png`);
      await page.screenshot({ path: filePath });
      const shot = { name, path: filePath };
      screenshots.push(shot);
      currentStepResult.screenshot = shot;
    } else if (currentStep.action === 'click') {
      let loc = getLocator(page, currentStep);
      try {
        await loc.waitFor({ state: 'attached', timeout: STEP_TIMEOUT });
        await loc.evaluate((el) => el.click());
      } catch (clickErr) {
        if (/timeout|exceeded/i.test(clickErr.message || '') && currentStep.selector && currentStep.text) {
          const textOnly = { ...currentStep, selector: undefined };
          loc = getLocator(page, textOnly);
          await loc.waitFor({ state: 'attached', timeout: STEP_TIMEOUT });
          await loc.evaluate((el) => el.click());
        } else {
          throw clickErr;
        }
      }
    } else if (currentStep.action === 'fill') {
      const value = currentStep.value != null ? String(currentStep.value) : '';
      const baseLoc = getLocator(page, currentStep);
      await baseLoc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
      const fillableSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea';
      try {
        await baseLoc.fill(value, { timeout: STEP_TIMEOUT });
      } catch (fillErr) {
        if (/not editable|readonly/i.test(fillErr.message || '')) {
          await baseLoc.evaluate(
            (el, v) => {
              el.value = v;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            },
            value,
          );
        } else if (/not visible|timeout/i.test(fillErr.message || '')) {
          const inner = baseLoc.locator(fillableSelector).first();
          await inner.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
          try {
            await inner.fill(value, { timeout: STEP_TIMEOUT });
          } catch (innerErr) {
            if (/not editable|readonly/i.test(innerErr.message || '')) {
              await inner.evaluate(
                (el, v) => {
                  el.value = v;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                },
                value,
              );
            } else {
              throw fillErr;
            }
          }
        } else {
          throw fillErr;
        }
      }
    } else if (currentStep.action === 'select') {
      const loc = getLocator(page, currentStep);
      await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
      const value = currentStep.value != null ? String(currentStep.value) : '';
      const label = currentStep.label != null ? String(currentStep.label) : '';
      if (label) await loc.selectOption({ label: label.trim() }, { timeout: STEP_TIMEOUT });
      else if (value) await loc.selectOption(value, { timeout: STEP_TIMEOUT });
    } else if (currentStep.action === 'wait') {
      const ms = Math.min(Number(currentStep.timeout) || 1000, 30000);
      await page.waitForTimeout(ms);
    } else if (currentStep.action === 'waitFor') {
      const timeoutMs = Math.min(Number(currentStep.timeout) || 15000, 60000);
      if (currentStep.selector) {
        const loc = page.locator(currentStep.selector);
        await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      } else if (currentStep.text) {
        const raw = String(currentStep.text).trim();
        const namePattern = raw ? new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /./;
        await page.getByText(namePattern).first().waitFor({ state: 'visible', timeout: timeoutMs });
      } else {
        throw new Error('waitFor 스텝에는 selector 또는 text 중 하나가 필요합니다.');
      }
    }
  }

  try {
    for (let index = 0; index < stepsToRun.length; index++) {
      const step = stepsToRun[index];
      const stepResult = {
        index,
        action: step.action,
        description: step.description || '',
        input: {
          url: step.url,
          name: step.name,
          testId: step.testId,
          text: step.text,
          selector: step.selector,
          value: step.value,
          label: step.label,
          timeout: step.timeout,
        },
        status: 'pending',
        error: null,
        screenshot: null,
      };

      try {
        await runOneStep(step, stepResult);
        stepResult.status = 'passed';
      } catch (err) {
        const isTimeout = /timeout|exceeded/i.test(err && err.message ? err.message : '');
        const canRetryWithGoto = ['click', 'fill', 'select', 'waitFor'].includes(step.action);
        if (isTimeout && canRetryWithGoto && originURL) {
          try {
            await page.goto(originURL, { waitUntil: 'load', timeout: 30000 });
            await page.waitForTimeout(2000);
            await runOneStep(step, stepResult);
            stepResult.status = 'passed';
          } catch (retryErr) {
            stepResult.status = 'failed';
            stepResult.error = retryErr && retryErr.message ? retryErr.message : String(retryErr);
            lastError = retryErr;
            stepResults.push(stepResult);
            break;
          }
        } else {
          stepResult.status = 'failed';
          stepResult.error = err && err.message ? err.message : String(err);
          lastError = err;
          stepResults.push(stepResult);
          break;
        }
      }

      stepResults.push(stepResult);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const duration = Date.now() - start;
  let errorMessage = lastError ? lastError.message : null;
  if (lastError && /getByTestId|Timeout.*exceeded/i.test(lastError.message)) {
    const testIdMatch = lastError.message.match(/getByTestId\(['"]([^'"]+)['"]\)/);
    const hint = testIdMatch
      ? `요소를 찾지 못했습니다 (data-testid="${testIdMatch[1]}"). 대상 페이지에 해당 속성이 있는지 확인하고, 없으면 생성된 TC에서 testId를 실제 페이지의 data-testid 또는 selector로 수정해 주세요.`
      : '요소를 찾는 중 시간이 초과되었습니다. 대상 페이지가 로드될 때까지 "N초 대기" 스텝을 추가하거나, 생성된 TC의 testId/selector를 실제 화면에 맞게 수정해 주세요.';
    errorMessage = hint + '\n\n(원인: ' + lastError.message + ')';
  }

  return {
    duration,
    screenshots,
    resultsDir,
    stepResults,
    error: errorMessage,
    passed: !lastError,
  };
}

module.exports = { runPlaywright };
