const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DEFAULT_CDP_URL = process.env.PLAYWRIGHT_CDP_URL || 'http://localhost:9222';
const CDP_TIMEOUT = 15000;

async function inspectUrlRuntime({ url, resultsDir, checks = [] }) {
  const consoleErrors = [];
  const consoleWarnings = [];
  let browser;
  let page;
  let context;
  const start = Date.now();

  const evidence = {
    url,
    title: '',
    httpOk: false,
    consoleErrors: [],
    screenshot: null,
    loginForm: { hasPassword: false, hasSubmit: false },
  };

  try {
    browser = await chromium.connectOverCDP(DEFAULT_CDP_URL, { timeout: CDP_TIMEOUT });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      if (msg.type() === 'warning') consoleWarnings.push(text);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message || String(err));
    });

    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1000);

    evidence.httpOk = response ? response.ok() : false;
    evidence.status = response ? response.status() : null;
    evidence.title = await page.title();

    const loginProbe = await page.evaluate(() => {
      const hasPassword = !!document.querySelector('input[type="password"]');
      const submitTexts = ['로그인', 'login', 'sign in', 'Sign in'];
      const buttons = Array.from(
        document.querySelectorAll('button, input[type="submit"], [role="button"]'),
      );
      const hasSubmit = buttons.some((el) => {
        const t = (el.innerText || el.value || '').trim().toLowerCase();
        return submitTexts.some((s) => t.includes(s.toLowerCase()));
      });
      return { hasPassword, hasSubmit };
    });
    evidence.loginForm = loginProbe;

    if (resultsDir) {
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
      const shotPath = path.join(resultsDir, 'runtime.png');
      await page.screenshot({ path: shotPath, fullPage: false });
      evidence.screenshot = shotPath;
    }

    evidence.consoleErrors = [...new Set(consoleErrors)];
    evidence.consoleWarnings = [...new Set(consoleWarnings)];

    const itemResults = checks.map((item) =>
      evaluatePlaywrightItem(item, evidence),
    );

    return {
      ok: true,
      duration: Date.now() - start,
      evidence,
      itemResults,
    };
  } catch (err) {
    return {
      ok: false,
      duration: Date.now() - start,
      error: err.message || String(err),
      evidence,
      itemResults: checks.map((item) => ({
        ...itemResultFields(item),
        status: 'fail',
        evidence: err.message || String(err),
        suggestion: 'Edge CDP 디버깅 모드가 실행 중인지 확인하세요.',
      })),
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

function itemResultFields(item) {
  return {
    itemId: item.itemKey || item.id,
    title: item.title,
    severity: item.severity,
    inspectType: item.inspectType,
    checklistName: item.checklistName,
    checklistKind: item.checklistKind,
  };
}

function evaluatePlaywrightItem(item, evidence) {
  const check = item.config && item.config.check;
  const base = itemResultFields(item);

  if (check === 'page_load') {
    return {
      ...base,
      status: evidence.httpOk ? 'pass' : 'fail',
      evidence: evidence.httpOk
        ? `HTTP ${evidence.status} 로드 성공`
        : `HTTP ${evidence.status || 'unknown'} 로드 실패`,
    };
  }

  if (check === 'no_console_error') {
    const errs = evidence.consoleErrors || [];
    return {
      ...base,
      status: errs.length === 0 ? 'pass' : 'fail',
      evidence:
        errs.length === 0
          ? 'console.error / pageerror 없음'
          : `콘솔 에러 ${errs.length}건: ${errs.slice(0, 3).join(' | ')}`,
      suggestion: errs.length ? '브라우저 콘솔 에러를 수정하세요.' : undefined,
    };
  }

  if (check === 'page_title') {
    const title = (evidence.title || '').trim();
    return {
      ...base,
      status: title.length > 0 ? 'pass' : 'fail',
      evidence: title ? `title: "${title}"` : 'title이 비어 있음',
    };
  }

  if (check === 'login_form') {
    const { hasPassword, hasSubmit } = evidence.loginForm || {};
    const ok = hasPassword || hasSubmit;
    return {
      ...base,
      status: ok ? 'pass' : 'fail',
      evidence: ok
        ? `password=${hasPassword}, submit=${hasSubmit}`
        : '로그인 폼 요소를 찾지 못함',
    };
  }

  return {
    ...base,
    status: 'skip',
    evidence: `지원하지 않는 Playwright check: ${check || '(없음)'}`,
  };
}

module.exports = { inspectUrlRuntime };
