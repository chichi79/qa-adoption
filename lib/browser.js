const http = require('http');

const DEFAULT_CDP_URL = process.env.PLAYWRIGHT_CDP_URL || 'http://localhost:9222';
const CDP_TIMEOUT = 8000;

function isCdpAvailable(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    try {
      const req = http.get(
        new URL('/json/version', url),
        { timeout: timeoutMs },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/** Vercel/Lambda: @sparticuz/chromium · 로컬: CDP Edge 또는 Playwright Chromium */
async function connectBrowser() {
  const { isVercel } = require('./paths');

  if (isVercel) {
    const chromium = require('@sparticuz/chromium');
    const { chromium: pwChromium } = require('playwright-core');
    chromium.setGraphicsMode = false;
    const browser = await pwChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    return { browser, launched: true };
  }

  const { chromium } = require('playwright');
  if (process.env.PLAYWRIGHT_SKIP_CDP === '1') {
    const browser = await chromium.launch({ headless: true });
    return { browser, launched: true };
  }

  const cdpUp = await isCdpAvailable(DEFAULT_CDP_URL);
  if (cdpUp) {
    try {
      const browser = await chromium.connectOverCDP(DEFAULT_CDP_URL, { timeout: CDP_TIMEOUT });
      return { browser, launched: false };
    } catch (_) {
      /* fallback launch */
    }
  }

  const browser = await chromium.launch({ headless: true });
  return { browser, launched: true };
}

module.exports = { connectBrowser, isCdpAvailable, DEFAULT_CDP_URL };
