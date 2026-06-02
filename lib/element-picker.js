/**
 * 요소 선택기(픽커): CDP로 대상 페이지를 띄우고, 사용자가 클릭한 요소의 selector/text를 반환
 */
const { chromium } = require('playwright');

const DEFAULT_CDP_URL = process.env.PLAYWRIGHT_CDP_URL || 'http://localhost:9222';
const CDP_TIMEOUT = 15000;
const PICKER_TIMEOUT_MS = 60000;

const INJECT_SCRIPT = `
(function() {
  var style = document.createElement('style');
  style.textContent = '.qa-picker-highlight { outline: 2px solid #2563eb !important; outline-offset: 2px; background: rgba(37,99,235,0.1) !important; }';
  document.head.appendChild(style);

  function getSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id && /^[a-zA-Z][\\w.-]*$/.test(el.id)) return '#' + el.id;
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.name && el.tagName === 'INPUT') return 'input[name="' + el.name + '"]';
    var path = [], cur = el;
    while (cur && cur !== document.body) {
      var tag = cur.tagName.toLowerCase();
      var idx = 1;
      var sib = cur.previousElementSibling;
      while (sib) { idx++; sib = sib.previousElementSibling; }
      path.unshift(tag + ':nth-child(' + idx + ')');
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function getVisibleText(el) {
    if (!el) return '';
    var t = (el.innerText || el.textContent || '').trim();
    if (t) return t.substring(0, 200);
    if (el.value !== undefined) return (el.value + '').trim().substring(0, 200);
    return '';
  }

  var lastHighlight = null;
  document.addEventListener('mouseover', function(e) {
    if (lastHighlight) lastHighlight.classList.remove('qa-picker-highlight');
    lastHighlight = e.target;
    if (lastHighlight && lastHighlight !== document.body) lastHighlight.classList.add('qa-picker-highlight');
  }, true);

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (lastHighlight) lastHighlight.classList.remove('qa-picker-highlight');
    var el = e.target;
    var selector = getSelector(el);
    var text = getVisibleText(el);
    if (window.reportPickerResult) window.reportPickerResult({ selector: selector, text: text });
  }, true);
})();
`;

/**
 * @param {Object} options
 * @param {string} options.url - 대상 페이지 URL
 * @param {string} [options.cdpUrl] - CDP 주소 (기본: DEFAULT_CDP_URL)
 * @param {number} [options.timeoutMs] - 클릭 대기 시간 (ms)
 * @returns {Promise<{ selector: string, text: string }>}
 */
async function runElementPicker(options = {}) {
  const { url, cdpUrl = DEFAULT_CDP_URL, timeoutMs = PICKER_TIMEOUT_MS } = options;
  if (!url || !url.trim()) {
    throw new Error('대상 페이지 URL을 입력해 주세요.');
  }

  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: CDP_TIMEOUT });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.close().catch(() => {});
      reject(new Error('요소 선택 시간이 초과되었습니다. 브라우저에서 페이지를 열고 클릭해 주세요.'));
    }, timeoutMs);

    page.exposeFunction('reportPickerResult', (data) => {
      clearTimeout(timer);
      context.close().catch(() => {});
      resolve({
        selector: (data && data.selector) ? String(data.selector) : '',
        text: (data && data.text) ? String(data.text).trim() : '',
      });
    });

    page.goto(url.trim(), { waitUntil: 'domcontentloaded', timeout: 30000 })
      .then(() => page.evaluate(INJECT_SCRIPT))
      .then(() => {
        // 사용자가 클릭할 때까지 대기 (reportPickerResult에서 resolve)
      })
      .catch((err) => {
        clearTimeout(timer);
        context.close().catch(() => {});
        reject(err);
      });
  });
}

module.exports = { runElementPicker, DEFAULT_CDP_URL };
