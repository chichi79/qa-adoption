/**
 * URL 한 개만 주면 페이지를 열고, 크롤링으로 성격 파악 후 규칙에 맞게 TC 스텝 자동 생성
 */
const { chromium } = require('playwright');

const DEFAULT_CDP_URL = process.env.PLAYWRIGHT_CDP_URL || 'http://localhost:9222';
const CDP_TIMEOUT = 15000;
const PAGE_TIMEOUT = 30000;
const MAX_LINKS = 5;

// 페이지 성격 파악용: 제목, 헤딩, 폼/입력/링크/버튼, nav/footer, 메인 영역 등
const CRAWL_PROFILE_SCRIPT = `
(function() {
  function getText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim().substring(0, 300);
  }
  var title = (document.title || '').trim();
  var metaDesc = '';
  var meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  if (meta && meta.content) metaDesc = meta.content.trim().substring(0, 200);
  var h1 = '';
  var firstH1 = document.querySelector('h1');
  if (firstH1) h1 = getText(firstH1);
  var h2List = [];
  document.querySelectorAll('h2').forEach(function(el, i) {
    if (i < 5) h2List.push(getText(el));
  });
  var inputNames = [];
  var hasPassword = false;
  var hasSearchLike = false;
  var hasEmail = false;
  var hasTel = false;
  var placeholderLabels = [];
  document.querySelectorAll('input:not([type="hidden"])').forEach(function(el) {
    var n = (el.name || el.id || '').toLowerCase();
    var t = (el.type || 'text').toLowerCase();
    if (n) inputNames.push(n);
    if (t === 'password') hasPassword = true;
    if (/password|pass|pwd|비밀/.test(n)) hasPassword = true;
    if (/q|keyword|search|query|검색/.test(n)) hasSearchLike = true;
    if (t === 'email' || /email|이메일|메일/.test(n)) hasEmail = true;
    if (t === 'tel' || /tel|phone|전화/.test(n)) hasTel = true;
    var ph = (el.placeholder || '').trim();
    if (ph) {
      placeholderLabels.push(ph);
      if (/검색|search|찾기/.test(ph)) hasSearchLike = true;
    }
  });
  var formCount = document.querySelectorAll('form').length;
  var linkCount = document.querySelectorAll('a[href]').length;
  var buttonCount = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').length;
  var submitButtonTexts = [];
  document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(function(el) {
    var t = getText(el) || (el.value || '').trim();
    if (t) submitButtonTexts.push(t);
  });
  var linkTextSamples = [];
  document.querySelectorAll('a[href]').forEach(function(el, i) {
    if (i < 15) linkTextSamples.push(getText(el));
  });
  var hasNav = !!document.querySelector('nav, [role="navigation"], .nav, .gnb, .navigation, header nav');
  var hasFooter = !!document.querySelector('footer, .footer, [role="contentinfo"]');
  var mainEl = document.querySelector('main, [role="main"], #content, #main, .main, .content');
  var mainTextLength = mainEl ? getText(mainEl).length : 0;
  var hasTable = !!document.querySelector('table');
  var tableRowCount = 0;
  var firstTable = document.querySelector('table tbody, table');
  if (firstTable) {
    var rows = firstTable.querySelectorAll('tr');
    tableRowCount = rows.length;
  }
  return {
    title: title,
    metaDesc: metaDesc,
    h1: h1,
    h2List: h2List,
    inputNames: inputNames,
    placeholderLabels: placeholderLabels,
    hasPassword: hasPassword,
    hasSearchLike: hasSearchLike,
    hasEmail: hasEmail,
    hasTel: hasTel,
    formCount: formCount,
    linkCount: linkCount,
    buttonCount: buttonCount,
    submitButtonTexts: submitButtonTexts,
    linkTextSamples: linkTextSamples,
    hasNav: hasNav,
    hasFooter: hasFooter,
    mainTextLength: mainTextLength,
    hasTable: hasTable,
    tableRowCount: tableRowCount
  };
})();
`;

/**
 * 크롤 결과 + URL 경로로 페이지 성격 분류
 * @param {Object} profile - CRAWL_PROFILE_SCRIPT 결과
 * @param {string} [urlPath] - URL 경로 (예: /login, /search)로 추가 힌트
 * @returns {'login'|'search'|'form'|'contact'|'listing'|'content'|'unknown'}
 */
function classifyPage(profile, urlPath = '') {
  if (!profile) return 'unknown';
  const {
    hasPassword,
    hasSearchLike,
    hasEmail,
    hasTel,
    inputNames,
    placeholderLabels,
    formCount,
    linkCount,
    buttonCount,
    submitButtonTexts,
    linkTextSamples,
    hasNav,
    mainTextLength,
    hasTable,
    tableRowCount,
    title,
    h1,
    h2List,
    metaDesc,
  } = profile;

  const pathLower = (urlPath || '').toLowerCase();
  const titleH1 = (title + ' ' + h1 + ' ' + (metaDesc || '') + ' ' + (h2List || []).join(' ')).toLowerCase();
  const placeholdersStr = (placeholderLabels || []).join(' ').toLowerCase();
  const submitStr = (submitButtonTexts || []).join(' ').toLowerCase();
  const linkStr = (linkTextSamples || []).join(' ').toLowerCase();

  // URL 경로 힌트
  if (/\/login|\/signin|\/sign-in|\/로그인|\/member\/login/.test(pathLower)) return 'login';
  if (/\/search|\/검색|\/find|\/query/.test(pathLower)) return 'search';
  if (/\/contact|\/문의|\/inquiry|\/support|\/help/.test(pathLower)) return 'contact';

  // 로그인: 비밀번호 필드 + 아이디/이메일류 또는 폼 1개
  if (hasPassword) {
    const hasIdLike = inputNames.some((n) => /user|id|email|아이디|이메일|account|login/.test(n));
    if (hasIdLike || (formCount >= 1 && inputNames.length <= 3)) return 'login';
  }

  // 검색: 검색형 필드 또는 제목/버튼에 검색, 또는 입력 1개 + 검색 버튼
  if (hasSearchLike) return 'search';
  if (/검색|search|find|찾기/.test(titleH1) || /검색|search/.test(submitStr)) return 'search';
  if (inputNames.length <= 2 && submitButtonTexts.some((t) => /검색|search|찾기/.test(t))) return 'search';

  // 문의/연락: 이메일+전화+여러 입력 또는 제출/보내기/문의 버튼
  if (formCount >= 1 && (hasEmail || hasTel) && inputNames.length >= 3) return 'contact';
  if (/제출|보내기|문의|등록|submit|send/.test(submitStr) && inputNames.length >= 2) return 'contact';

  // 목록: 테이블 다수 행 또는 링크 많음 + nav, 또는 링크 텍스트가 메뉴/목록 성격
  if (hasTable && tableRowCount > 3) return 'listing';
  if (linkCount > 12 && hasNav && inputNames.length <= 1) return 'listing';
  if (linkCount > 8 && (mainTextLength < 500 || /목록|리스트|list|메뉴|menu/.test(linkStr))) return 'listing';

  // 일반 폼: 폼 + 입력 2개 이상 또는 버튼
  if (formCount > 0 && (inputNames.length >= 2 || buttonCount > 0)) return 'form';

  // 콘텐츠: 링크 적고 입력/버튼 없거나 최소
  if (linkCount <= 6 && inputNames.length === 0 && buttonCount === 0) return 'content';
  if (linkCount <= 5 && mainTextLength > 300) return 'content';

  return 'unknown';
}

// 셀렉터 품질: data-testid > id > name > aria-label > placeholder > nth-child, 가시성 필터 + form 단위 수집
const DISCOVER_SCRIPT = `
(function() {
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    var vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return false;
    return true;
  }

  function getBestSelector(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase();
    var testId = el.getAttribute('data-testid');
    if (testId && /^[^"\\s]+$/.test(testId)) return '[data-testid="' + testId + '"]';
    var id = (el.id || '').trim();
    if (id && /^[a-zA-Z][\\w.-]*$/.test(id)) return '#' + id;
    if (el.name && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      var name = (el.name || '').trim();
      if (name) return tag + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
    }
    var aria = (el.getAttribute('aria-label') || '').trim();
    if (aria && aria.length < 100) return tag + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
    var ph = (el.placeholder || '').trim();
    if (ph && (tag === 'input' || tag === 'textarea') && ph.length < 80)
      return tag + '[placeholder="' + ph.replace(/"/g, '\\\\"').substring(0, 80) + '"]';
    if (tag === 'input' || tag === 'textarea') {
      var autocomplete = (el.getAttribute('autocomplete') || '').trim().toLowerCase();
      if (autocomplete && /^(email|tel|username|current-password|off|one-time-code|search)$/.test(autocomplete)) {
        var selAc = tag + '[autocomplete="' + autocomplete.replace(/"/g, '\\\\"') + '"]';
        if (document.querySelectorAll(selAc).length === 1) return selAc;
      }
      var type = (el.type || 'text').toLowerCase();
      if (/^(email|tel|password|search)$/.test(type)) {
        var selType = tag + '[type="' + type + '"]';
        if (document.querySelectorAll(selType).length === 1) return selType;
      }
    }
    if (tag === 'button' || (tag === 'input' && (el.type === 'submit' || el.type === 'button'))) {
      var btnType = (el.type || '').toLowerCase();
      if (btnType === 'submit' || btnType === 'button') {
        var selBtn = tag + '[type="' + btnType + '"]';
        if (document.querySelectorAll(selBtn).length === 1) return selBtn;
      }
    }
    var path = [], cur = el;
    while (cur && cur !== document.body) {
      var t = cur.tagName.toLowerCase();
      var idx = 1;
      var sib = cur.previousElementSibling;
      while (sib) { idx++; sib = sib.previousElementSibling; }
      path.unshift(t + ':nth-child(' + idx + ')');
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function getFormIndex(el) {
    var form = el.form;
    if (!form || !document.forms) return -1;
    for (var i = 0; i < document.forms.length; i++) {
      if (document.forms[i] === form) return i;
    }
    return -1;
  }

  function getRegion(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      var tag = (cur.tagName || '').toLowerCase();
      var role = (cur.getAttribute('role') || '').toLowerCase();
      var id = (cur.id || '').toLowerCase();
      var cls = (cur.className && typeof cur.className === 'string') ? cur.className.toLowerCase() : '';
      if (tag === 'main' || role === 'main' || id === 'main' || id === 'content' || /\\bmain\\b|\\bcontent\\b/.test(cls)) return 'main';
      if (tag === 'nav' || role === 'navigation' || /\\bnav\\b|\\bgnb\\b|\\bnavigation\\b/.test(cls)) return 'nav';
      if (tag === 'footer' || role === 'contentinfo' || /\\bfooter\\b/.test(cls)) return 'footer';
      cur = cur.parentElement;
    }
    return 'other';
  }

  function getText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim().substring(0, 150);
  }

  var inputs = [];
  document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])').forEach(function(el) {
    if (!isVisible(el)) return;
    var sel = getBestSelector(el);
    if (!sel) return;
    inputs.push({
      selector: sel,
      name: (el.name || '').trim(),
      placeholder: (el.placeholder || '').trim(),
      type: (el.type || 'text').toLowerCase(),
      formIndex: getFormIndex(el),
      region: getRegion(el),
      required: !!(el.required || el.getAttribute('aria-required') === 'true')
    });
  });

  var textareas = [];
  document.querySelectorAll('textarea').forEach(function(el) {
    if (!isVisible(el)) return;
    var sel = getBestSelector(el);
    if (!sel) return;
    textareas.push({
      selector: sel,
      name: (el.name || '').trim(),
      placeholder: (el.placeholder || '').trim(),
      formIndex: getFormIndex(el),
      region: getRegion(el),
      required: !!(el.required || el.getAttribute('aria-required') === 'true')
    });
  });

  var selects = [];
  document.querySelectorAll('select').forEach(function(el) {
    if (!isVisible(el)) return;
    var sel = getBestSelector(el);
    if (!sel) return;
    var options = [];
    el.querySelectorAll('option').forEach(function(opt) {
      var v = (opt.value || '').trim();
      var l = (opt.textContent || opt.text || '').trim();
      if (v || l) options.push({ value: v || l, label: l || v });
    });
    selects.push({
      selector: sel,
      name: (el.name || '').trim(),
      formIndex: getFormIndex(el),
      region: getRegion(el),
      options: options,
      required: !!(el.required || el.getAttribute('aria-required') === 'true')
    });
  });

  var checkboxes = [];
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(function(el) {
    if (!isVisible(el)) return;
    var sel = getBestSelector(el);
    if (!sel) return;
    var labelText = '';
    var id = el.id;
    if (id && document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]')) {
      var labelEl = document.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
      if (labelEl) labelText = (labelEl.textContent || '').trim().substring(0, 80);
    }
    if (!labelText) {
      var par = el.parentElement;
      if (par && (par.tagName === 'LABEL' || par.querySelector('label'))) labelText = getText(par).substring(0, 80);
    }
    checkboxes.push({
      selector: sel,
      type: (el.type || 'checkbox').toLowerCase(),
      formIndex: getFormIndex(el),
      region: getRegion(el),
      label: labelText,
      checked: !!el.checked
    });
  });

  var buttons = [];
  document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach(function(el) {
    if (!isVisible(el)) return;
    var text = getText(el) || (el.value || '').trim();
    if (!text && el.type !== 'submit') return;
    var sel = getBestSelector(el);
    if (!sel) return;
    buttons.push({
      selector: sel,
      text: (text || '').trim(),
      formIndex: getFormIndex(el),
      region: getRegion(el)
    });
  });

  var links = [];
  var loc = window.location;
  document.querySelectorAll('a[href]').forEach(function(el) {
    if (!isVisible(el)) return;
    var text = getText(el);
    var href = (el.getAttribute('href') || '').trim();
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
    var sel = getBestSelector(el);
    if (!sel) return;
    var isSamePage = false;
    try {
      var u = new URL(href, loc.href);
      isSamePage = u.pathname === loc.pathname && !u.search;
    } catch (e) { isSamePage = true; }
    if (href.startsWith('#')) isSamePage = true;
    links.push({ selector: sel, text: text, href: href, region: getRegion(el), isSamePage: isSamePage });
  });

  var tabs = [];
  var tabSelectors = [
    '[role="tab"]',
    '[data-toggle="tab"], [data-bs-toggle="tab"]',
    '.nav-tabs .nav-link, .nav-tabs button',
    '.tab-list a, .tab-list button',
    '[class*="tab__"]'
  ];
  var seenTabSel = {};
  tabSelectors.forEach(function(q) {
    try {
      document.querySelectorAll(q).forEach(function(el) {
        if (!isVisible(el)) return;
        var sel = getBestSelector(el);
        if (!sel || seenTabSel[sel]) return;
        seenTabSel[sel] = true;
        var text = getText(el);
        tabs.push({ selector: sel, text: (text || '').trim(), region: getRegion(el) });
      });
    } catch (e) {}
  });

  function getPagingType(el, text) {
    var t = (text || '').toLowerCase().trim();
    var rel = (el.getAttribute('rel') || '').toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (rel === 'next' || /^next|다음|›|»|>$/i.test(t) || /next|다음/.test(aria)) return 'next';
    if (rel === 'prev' || /^prev|previous|이전|‹|«|<$/i.test(t) || /prev|이전/.test(aria)) return 'prev';
    if (/^\\d+$/.test(t) && parseInt(t, 10) >= 2) return 'page';
    return null;
  }
  var paging = [];
  var pagingSelectors = [
    'a[rel="next"], a[rel="prev"]',
    '.pagination a, .pagination button',
    '.paging a, .paging button',
    '.page-nav a, .page-nav button',
    '.pager a, .pager button',
    '[aria-label*="next"], [aria-label*="prev"], [aria-label*="다음"], [aria-label*="이전"]'
  ];
  var seenPagingSel = {};
  pagingSelectors.forEach(function(q) {
    try {
      document.querySelectorAll(q).forEach(function(el) {
        if (!isVisible(el)) return;
        var sel = getBestSelector(el);
        if (!sel || seenPagingSel[sel]) return;
        var text = (getText(el) || '').trim();
        var type = getPagingType(el, text);
        if (!type) return;
        seenPagingSel[sel] = true;
        paging.push({ selector: sel, text: text, region: getRegion(el), type: type });
      });
    } catch (e) {}
  });

  return { inputs: inputs, textareas: textareas, selects: selects, checkboxes: checkboxes, buttons: buttons, links: links, tabs: tabs, paging: paging };
})();
`;

/**
 * 타입/이름 기반 시맨틱 fill 값 및 설명 반환
 * @param {{ name?: string, placeholder?: string, type?: string }} inp - 수집된 input 정보
 * @param {string} pageType - classifyPage 결과
 * @returns {{ value: string, description: string }}
 */
function getSemanticFillValue(inp, pageType) {
  const name = (inp.name || '').toLowerCase();
  const placeholder = (inp.placeholder || '').trim();
  const type = (inp.type || 'text').toLowerCase();

  if (type === 'email' || /email|이메일|메일/.test(name)) {
    return { value: 'test@example.com', description: '이메일 입력 (테스트용)' };
  }
  if (type === 'tel' || /tel|phone|전화/.test(name)) {
    return { value: '010-0000-0000', description: '전화번호 입력 (테스트용)' };
  }
  if (/q|keyword|search|query|검색|찾기/.test(name) || /검색|search|찾기/.test(placeholder)) {
    return { value: '검색어', description: '검색어 입력' };
  }
  if (pageType === 'login') {
    if (/password|pass|pwd|비밀/.test(name)) {
      return { value: '(비밀번호)', description: '비밀번호 입력 (테스트용)' };
    }
    if (/user|id|email|아이디|이메일|account|login/.test(name)) {
      return { value: 'testuser', description: '아이디 입력 (테스트용)' };
    }
  }
  const value = placeholder || '(값 입력)';
  const label = inp.name || '입력';
  return { value, description: `${label} 필드: ${value}` };
}

/**
 * 페이지 타입에 맞는 주요 CTA 버튼 선택 (없으면 첫 번째)
 * @param {Array<{ text: string, selector: string }>} buttons
 * @param {string} pageType
 * @returns {{ text: string, selector: string } | null}
 */
function pickPrimaryButton(buttons, pageType) {
  if (!buttons || buttons.length === 0) return null;
  const preferred = {
    login: [/^\s*로그인\s*$/i, /sign\s*in/i, /^login\s*$/i],
    search: [/검색/, /찾기/, /search/i],
    form: [/제출|저장|등록|보내기|submit|save|등록/i],
    contact: [/제출|보내기|문의|등록|submit|send/i],
    unknown: [/제출|저장|등록|확인|submit|save|확인/i],
  };
  const patterns = preferred[pageType] || preferred.unknown;
  for (const pattern of patterns) {
    const found = buttons.find((b) => b.text && pattern.test(b.text.trim()));
    if (found) return found;
  }
  return buttons[0];
}

/**
 * 테스트할 링크만 필터: main 우선, 실제 이동하는 링크만, href 중복 제거 후 상위 N개
 * @param {Array<{ selector: string, text: string, href: string, region?: string, isSamePage?: boolean }>} links
 * @param {string} baseUrl - 기준 URL (상대 href 해석용)
 * @param {number} limit
 * @returns {Array}
 */
function filterLinksToTestWorthy(links, baseUrl, limit) {
  if (!links || links.length === 0) return [];
  let baseOrigin = '';
  let basePathname = '/';
  try {
    const u = new URL(baseUrl);
    baseOrigin = u.origin;
    basePathname = u.pathname || '/';
  } catch (_) {}

  const normalizeHref = (href) => {
    try {
      const u = new URL(href, baseUrl);
      return u.origin + u.pathname + (u.search || '');
    } catch (_) {
      return href;
    }
  };

  // 실제로 다른 페이지로 이동하는 링크만 (같은 페이지 해시/같은 path 제외)
  const navigatesAway = links.filter((l) => !l.isSamePage);

  // 영역 우선순위: main > other > nav > footer
  const regionOrder = { main: 0, other: 1, nav: 2, footer: 3 };
  const score = (l) => regionOrder[l.region] ?? 1;

  const sorted = [...navigatesAway].sort((a, b) => score(a) - score(b));

  // href 기준 중복 제거 (같은 정규화 href는 첫 번째만)
  const seen = new Set();
  const deduped = [];
  for (const link of sorted) {
    const key = normalizeHref(link.href);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped.slice(0, limit);
}

/** goto 후 탭이 있으면 첫 탭 클릭+대기 추가 (크롤링했던 뷰 복원) */
function pushGotoAndRestoreTab(steps, baseUrl, allTabs, description) {
  steps.push({ action: 'goto', url: baseUrl, description: description || '대상 페이지로 이동' });
  if (allTabs && allTabs.length > 0) {
    const firstTab = allTabs[0];
    if (firstTab.text) {
      steps.push({ action: 'click', text: firstTab.text, selector: firstTab.selector, description: `탭 클릭: ${firstTab.text}` });
    } else {
      steps.push({ action: 'click', selector: firstTab.selector, description: '탭 클릭' });
    }
    steps.push({ action: 'wait', timeout: 2000, description: '탭 전환 대기' });
  }
}

/** select 옵션 중 플레이스홀더(선택하세요 등)가 아닌 첫 번째 실제 옵션 반환 */
function getFirstRealOption(options) {
  if (!options || options.length === 0) return null;
  const placeholderPattern = /^\s*$|^선택|선택하세요|--\s*선택|select\s*one|choose|please\s*select|선택해\s*주세요|고르세요|없음|none$/i;
  for (const opt of options) {
    const v = (opt.value || '').trim();
    const l = (opt.label || '').trim();
    const text = (v || l).toLowerCase();
    if (!text) continue;
    if (placeholderPattern.test(v) || placeholderPattern.test(l)) continue;
    if (/^--+$|^\.\.\.$/.test(v) || /^--+$|^\.\.\.$/.test(l)) continue;
    return opt;
  }
  return options[0];
}

/** 폼 블록 하나에서 스텝 생성 (fill → textarea → select → checkbox → 버튼들). baseUrl, pageType, steps 배열에 push. allTabs 있으면 goto 후 첫 탭 복원 */
function appendStepsForFormBlock(steps, block, baseUrl, pageType, typeLabel, isFirstBlock, allTabs) {
  const { inputs, textareas, selects, checkboxes, buttons } = block;
  const sortedInputs = [...inputs].sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));

  if (!isFirstBlock) {
    pushGotoAndRestoreTab(steps, baseUrl, allTabs, '대상 페이지로 이동');
  }

  for (const inp of sortedInputs) {
    if (!inp.selector) continue;
    const { value, description } = getSemanticFillValue(inp, pageType);
    steps.push({ action: 'fill', selector: inp.selector, value, description });
  }
  for (const ta of textareas) {
    if (!ta.selector) continue;
    const value = ta.placeholder || '(내용 입력)';
    steps.push({
      action: 'fill',
      selector: ta.selector,
      value,
      description: `텍스트 영역: ${ta.name || '내용'} ${value}`,
    });
  }
  for (const sel of selects) {
    if (!sel.selector || !sel.options || sel.options.length === 0) continue;
    const chosen = getFirstRealOption(sel.options);
    if (!chosen) continue;
    const value = chosen.value || chosen.label;
    const label = chosen.label || chosen.value;
    steps.push({
      action: 'select',
      selector: sel.selector,
      value,
      label,
      description: `선택: ${sel.name || '항목'} → ${label}`,
    });
  }
  for (const cb of checkboxes) {
    if (!cb.selector) continue;
    const desc = cb.label ? `체크: ${cb.label}` : (cb.type === 'radio' ? '라디오 선택' : '체크박스 선택');
    steps.push({ action: 'click', selector: cb.selector, description: desc });
  }

  const primary = pickPrimaryButton(buttons, pageType);
  if (primary) {
    const hasRealText = primary.text && primary.text.trim() && primary.text.trim() !== '제출';
    if (hasRealText) {
      steps.push({ action: 'click', text: primary.text.trim(), selector: primary.selector, description: `${primary.text.trim()} 클릭` });
    } else {
      steps.push({ action: 'click', selector: primary.selector, description: '버튼 클릭' });
    }
  }

  const blockLabel = isFirstBlock ? typeLabel : '폼';
  steps.push({ action: 'screenshot', name: `form-${steps.length}-result`, description: `${blockLabel} 제출 결과` });

  // 보조 버튼: 동일 폼의 나머지 버튼 각각에 대해 goto → 동일 입력 → 해당 버튼 클릭 → 스크린샷 (최대 2개)
  const others = buttons.filter((b) => b !== primary);
  const secondaryLimit = 2;
  for (let i = 0; i < Math.min(others.length, secondaryLimit); i++) {
    const btn = others[i];
    pushGotoAndRestoreTab(steps, baseUrl, allTabs, '대상 페이지로 이동');
    for (const inp of sortedInputs) {
      if (!inp.selector) continue;
      const { value, description } = getSemanticFillValue(inp, pageType);
      steps.push({ action: 'fill', selector: inp.selector, value, description });
    }
    for (const ta of textareas) {
      if (!ta.selector) continue;
      steps.push({ action: 'fill', selector: ta.selector, value: ta.placeholder || '(내용 입력)', description: `텍스트 영역: ${ta.name || '내용'}` });
    }
    for (const cb of checkboxes) {
      if (cb.selector) steps.push({ action: 'click', selector: cb.selector, description: cb.label ? `체크: ${cb.label}` : '체크' });
    }
    for (const sel of selects) {
      if (!sel.selector || !sel.options || sel.options.length === 0) continue;
      const chosen = getFirstRealOption(sel.options);
      if (!chosen) continue;
      const value = chosen.value || chosen.label;
      const label = chosen.label || chosen.value;
      steps.push({ action: 'select', selector: sel.selector, value, label, description: `선택: ${sel.name || '항목'} → ${label}` });
    }
    const hasRealText = btn.text && btn.text.trim() && btn.text.trim() !== '제출';
    if (hasRealText) {
      steps.push({ action: 'click', text: btn.text.trim(), selector: btn.selector, description: `${btn.text.trim()} 클릭` });
    } else {
      steps.push({ action: 'click', selector: btn.selector, description: '버튼 클릭' });
    }
    steps.push({ action: 'screenshot', name: `form-${steps.length}-alt`, description: `대안 버튼 결과: ${hasRealText ? btn.text.trim() : '버튼'}` });
  }
}

/**
 * @param {Object} options
 * @param {string} options.url - 대상 페이지 URL
 * @param {string} [options.cdpUrl]
 * @param {number} [options.maxLinks] - 자동 클릭할 링크 개수 (기본 5)
 * @returns {Promise<Array<object>>} steps
 */
async function discoverStepsFromUrl(options = {}) {
  const { url, cdpUrl = DEFAULT_CDP_URL, maxLinks = MAX_LINKS } = options;
  if (!url || !url.trim()) throw new Error('URL을 입력해 주세요.');

  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: CDP_TIMEOUT });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    await page.goto(url.trim(), { waitUntil: 'load', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(1500);
    await page.waitForSelector('body', { state: 'attached', timeout: 5000 }).catch(function() {});
  } catch (err) {
    await context.close();
    throw err;
  }

  let data;
  let profile;
  try {
    data = await page.evaluate(DISCOVER_SCRIPT);
    profile = await page.evaluate(CRAWL_PROFILE_SCRIPT);
  } catch (e) {
    await context.close();
    throw new Error('페이지 요소 수집 실패: ' + (e.message || e));
  }

  const allTabsPre = (data.tabs || []).slice(0, 8);
  if (allTabsPre.length > 0) {
    try {
      const firstTab = allTabsPre[0];
      if (firstTab.selector) {
        await page.locator(firstTab.selector).first().click({ timeout: 5000 });
        await page.waitForTimeout(600);
        data = await page.evaluate(DISCOVER_SCRIPT);
      }
    } catch (tabErr) {}
  }

  await context.close();

  let urlPath = '';
  try {
    const u = new URL(url.trim());
    urlPath = u.pathname || '';
  } catch (_) {}

  const pageType = classifyPage(profile, urlPath);
  const steps = [];
  const baseUrl = url.trim().replace(/\/$/, '');
  const typeLabel = PAGE_TYPE_LABELS[pageType] || pageType;

  steps.push({ action: 'goto', url: baseUrl, description: `페이지 이동 (${typeLabel} 페이지로 감지)` });

  const rawInputs = data.inputs || [];
  const rawTextareas = data.textareas || [];
  const rawSelects = data.selects || [];
  const rawCheckboxes = data.checkboxes || [];
  const rawButtons = data.buttons || [];
  const allLinks = data.links || [];
  const allTabs = (data.tabs || []).slice(0, 8);
  const allPaging = data.paging || [];

  // 9번: 첫 탭만 먼저 클릭·대기 → 이어서 폼 스텝(현재 뷰=첫 탭 기준) → 나머지 탭은 클릭·대기·스크린샷만
  if (allTabs.length > 0) {
    const firstTab = allTabs[0];
    if (firstTab.text) {
      steps.push({ action: 'click', text: firstTab.text, selector: firstTab.selector, description: `탭 클릭: ${firstTab.text}` });
    } else {
      steps.push({ action: 'click', selector: firstTab.selector, description: '탭 클릭' });
    }
    steps.push({ action: 'wait', timeout: 2000, description: '탭 전환 대기' });
  }

  // 폼별로 그룹 (formIndex → { inputs, textareas, selects, checkboxes, buttons })
  const formBlocks = new Map();
  const addToBlock = (formIndex, key, item) => {
    const idx = formIndex === undefined || formIndex === null ? -1 : formIndex;
    if (!formBlocks.has(idx)) {
      formBlocks.set(idx, { inputs: [], textareas: [], selects: [], checkboxes: [], buttons: [] });
    }
    formBlocks.get(idx)[key].push(item);
  };
  rawInputs.forEach((inp) => addToBlock(inp.formIndex, 'inputs', inp));
  rawTextareas.forEach((ta) => addToBlock(ta.formIndex, 'textareas', ta));
  rawSelects.forEach((s) => addToBlock(s.formIndex, 'selects', s));
  rawCheckboxes.forEach((cb) => addToBlock(cb.formIndex, 'checkboxes', cb));
  rawButtons.forEach((b) => addToBlock(b.formIndex, 'buttons', b));

  // 폼 인덱스 순서: 0, 1, 2, ... then -1 (standalone)
  const formIndices = [...formBlocks.keys()].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));

  // 링크 상한 확대: 테스트할 수 있는 링크를 최대한 많이
  const linkLimit =
    pageType === 'login' ? 2
    : pageType === 'search' ? 5
    : pageType === 'contact' ? 3
    : pageType === 'form' ? 6
    : pageType === 'listing' ? 10
    : pageType === 'content' ? 8
    : Math.max(maxLinks, 8);
  const links = filterLinksToTestWorthy(allLinks, baseUrl, linkLimit);

  const listingOrContent = pageType === 'listing' || pageType === 'content';

  if (listingOrContent) {
    steps.push({ action: 'screenshot', name: 'page-overview', description: '페이지 개요' });
    // 목록/콘텐츠라도 검색 등 폼이 있으면 첫 폼 블록 스텝 추가
    for (const formIdx of formIndices) {
      const block = formBlocks.get(formIdx);
      if (!block) continue;
      const hasAny = block.inputs.length > 0 || block.textareas.length > 0 || block.selects.length > 0 || block.checkboxes.length > 0 || block.buttons.length > 0;
      if (!hasAny) continue;
      appendStepsForFormBlock(steps, block, baseUrl, pageType, typeLabel, false, allTabs);
      break;
    }
  } else {
    // 폼 블록별 스텝 생성 (각 폼에 대해 입력 → CTA → 스크린샷, 보조 버튼까지)
    let first = true;
    for (const formIdx of formIndices) {
      const block = formBlocks.get(formIdx);
      if (!block) continue;
      const hasAny = block.inputs.length > 0 || block.textareas.length > 0 || block.selects.length > 0 || block.checkboxes.length > 0 || block.buttons.length > 0;
      if (!hasAny) continue;
      appendStepsForFormBlock(steps, block, baseUrl, pageType, typeLabel, first, allTabs);
      first = false;
    }
    if (first) {
      steps.push({ action: 'screenshot', name: 'page-overview', description: '페이지 개요' });
    }
  }

  // 나머지 탭: 2번째 탭부터 클릭 → 대기 → 스크린샷 (첫 탭은 이미 클릭 후 폼 스텝 실행됨)
  for (let t = 1; t < allTabs.length; t++) {
    const tab = allTabs[t];
    if (tab.text) {
      steps.push({ action: 'click', text: tab.text, selector: tab.selector, description: `탭 클릭: ${tab.text}` });
    } else {
      steps.push({ action: 'click', selector: tab.selector, description: '탭 클릭' });
    }
    steps.push({ action: 'wait', timeout: 2000, description: '탭 전환 대기' });
    steps.push({ action: 'screenshot', name: `tab-${(tab.text || 'tab').replace(/\s+/g, '-').slice(0, 15)}`, description: `탭 "${tab.text || '선택'}" 화면 확인` });
  }

  for (const link of links) {
    pushGotoAndRestoreTab(steps, baseUrl, allTabs, '대상 페이지로 이동');
    const label = link.text || link.href || '링크';
    if (link.selector) {
      steps.push({ action: 'click', selector: link.selector, text: link.text || undefined, description: `링크: ${label}` });
    } else if (link.text) {
      steps.push({ action: 'click', text: link.text, description: `링크: ${label}` });
    }
    steps.push({ action: 'screenshot', name: `link-${label.replace(/\s+/g, '-').slice(0, 20)}`, description: `링크 이동 결과: ${label}` });
  }

  // 페이지네이션: 다음 → (이전) → 페이지 번호 1~2개 (페이징 동작 검증)
  const nextCtrl = allPaging.find((p) => p.type === 'next');
  const prevCtrl = allPaging.find((p) => p.type === 'prev');
  const pageNumbers = allPaging.filter((p) => p.type === 'page').slice(0, 2);
  if (nextCtrl) {
    pushGotoAndRestoreTab(steps, baseUrl, allTabs, '대상 페이지로 이동 (페이징 검증)');
    if (nextCtrl.text) {
      steps.push({ action: 'click', text: nextCtrl.text, selector: nextCtrl.selector, description: `페이징: 다음 (${nextCtrl.text}) 클릭` });
    } else {
      steps.push({ action: 'click', selector: nextCtrl.selector, description: '페이징: 다음 클릭' });
    }
    steps.push({ action: 'wait', timeout: 800, description: '페이지 전환 대기' });
    steps.push({ action: 'screenshot', name: 'paging-next', description: '다음 페이지 화면 확인' });
    if (prevCtrl) {
      if (prevCtrl.text) {
        steps.push({ action: 'click', text: prevCtrl.text, selector: prevCtrl.selector, description: `페이징: 이전 (${prevCtrl.text}) 클릭` });
      } else {
        steps.push({ action: 'click', selector: prevCtrl.selector, description: '페이징: 이전 클릭' });
      }
      steps.push({ action: 'wait', timeout: 500, description: '페이지 전환 대기' });
      steps.push({ action: 'screenshot', name: 'paging-prev', description: '이전 페이지 복귀 확인' });
    }
  }
  for (const pg of pageNumbers) {
    pushGotoAndRestoreTab(steps, baseUrl, allTabs, '대상 페이지로 이동');
    if (pg.text) {
      steps.push({ action: 'click', text: pg.text, selector: pg.selector, description: `페이징: ${pg.text}페이지 클릭` });
    } else {
      steps.push({ action: 'click', selector: pg.selector, description: '페이징: 페이지 번호 클릭' });
    }
    steps.push({ action: 'wait', timeout: 800, description: '페이지 전환 대기' });
    steps.push({ action: 'screenshot', name: `paging-${pg.text || 'n'}`, description: `페이징: ${pg.text || '해당'}페이지 화면 확인` });
  }

  steps.push({ action: 'screenshot', name: 'auto-result', description: '결과 화면' });

  return { steps, pageType };
}

const PAGE_TYPE_LABELS = {
  login: '로그인',
  search: '검색',
  form: '일반 폼',
  contact: '문의/연락',
  listing: '목록',
  content: '콘텐츠',
  unknown: '일반',
};

module.exports = { discoverStepsFromUrl, classifyPage, PAGE_TYPE_LABELS, DEFAULT_CDP_URL };
