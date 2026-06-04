const API = '/api';

const $ = (id) => document.getElementById(id);

function fetchWithTimeout(url, options = {}, ms = 15000) {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const CATEGORY_ORDER = [
  'runtime',
  'performance',
  'links',
  'accessibility',
  'seo',
  'html',
  'security',
];

let currentRunId = null;
let pollTimer = null;
let pollMissCount = 0;
let lastRun = null;
let batchViewRun = null;
let allChecks = [];
let insightsRunId = null;
let compareSelection = '';
let resultFilter = 'all';
let hideSkip = true;
let autoFilterApplied = false;
let dashboardLaneFilter = null;

const CATEGORY_TO_LANE = {
  runtime: 'runtime',
  performance: 'quality',
  links: 'quality',
  html: 'quality',
  security: 'security',
  accessibility: 'a11y_seo',
  seo: 'a11y_seo',
};

const PROCESS_STEPS = [
  { id: 1, label: 'URL·세트' },
  { id: 2, label: '자동 점검' },
  { id: 3, label: '오류 대시보드' },
  { id: 4, label: '이전과 비교' },
  { id: 5, label: '기록·CI' },
];

function laneForCategory(cat) {
  return CATEGORY_TO_LANE[cat] || 'quality';
}

function updateProcessFlow(activeStep) {
  const flow = $('process-flow');
  if (!flow) return;
  flow.querySelectorAll('.process-step').forEach((el) => {
    const step = Number(el.dataset.step);
    el.classList.toggle('active', step === activeStep);
    el.classList.toggle('done', step < activeStep);
  });
}

function detectProcessStep() {
  if ($('results-section') && !$('results-section').hidden) {
    if ($('insights-panel') && !$('insights-panel').hidden && !$('diff-panel')?.hidden) return 4;
    if ($('issue-dashboard-panel') && !$('issue-dashboard-panel').hidden) return 3;
    return 3;
  }
  if ($('progress-section') && !$('progress-section').hidden) return 2;
  return 1;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(text, type) {
  const el = $('form-status');
  if (!text) {
    el.textContent = '';
    el.className = 'form-status';
    return;
  }
  const map = {
    error: 'is-error',
    success: 'is-success',
    loading: 'is-loading',
  };
  el.textContent = text;
  el.className = 'form-status ' + (map[type] || '');
}

function statusLabel(s) {
  return { pass: 'PASS', fail: 'FAIL', pending: '…', skip: 'SKIP' }[s] || s;
}

function categoryLabel(c) {
  return (
    {
      runtime: '런타임',
      links: '링크',
      accessibility: '접근성',
      seo: 'SEO',
      html: 'HTML',
      security: '보안',
      performance: '성능',
    }[c] || c
  );
}

function severityLabel(s) {
  return { blocker: '치명', major: '중요', minor: '경미' }[s] || s;
}

function severityBadgeClass(s) {
  return { blocker: 'blocker', major: 'major', minor: 'minor' }[s] || 'minor';
}

function updateCheckCounts(count) {
  const n = count || allChecks.length || 51;
  const nav = $('nav-check-count');
  if (nav) nav.textContent = `${n}항목`;
}

function groupByCategory(items, key = 'category') {
  const map = new Map();
  items.forEach((item) => {
    const cat = item[key] || 'runtime';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(item);
  });
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
    category: c,
    items: map.get(c),
  }));
}

function renderChecksList(checks, searchQuery = '') {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? checks.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          categoryLabel(c.category).toLowerCase().includes(q),
      )
    : checks;

  if (filtered.length === 0) {
    $('checks-list').innerHTML = '<p class="empty-msg mb-0">검색 결과 없음</p>';
    return;
  }

  const groups = groupByCategory(filtered, 'category');
  $('checks-list').innerHTML = groups
    .map(
      (g, idx) => `
      <details class="checks-details" ${idx === 0 ? 'open' : ''}>
        <summary class="checks-summary">
          ${categoryLabel(g.category)}
          <span class="chip">${g.items.length}</span>
        </summary>
        <div class="checks-details-body">
          ${g.items
            .map(
              (c) => `
            <div class="check-item-row">
              <div class="check-name">${escapeHtml(c.title)}</div>
              <div class="check-desc">${escapeHtml(c.description)}</div>
            </div>`,
            )
            .join('')}
        </div>
      </details>`,
    )
    .join('');
}

async function loadChecksList() {
  try {
    const res = await fetchWithTimeout(`${API}/checks`, {}, 15000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allChecks = data.checks || [];
    updateCheckCounts(allChecks.length);
    renderChecksList(allChecks);
  } catch (_) {
    $('checks-list').innerHTML = '<p class="empty-msg mb-0 text-danger">목록 로드 실패</p>';
  }
}

const URL_PREFIX = 'https://';

function isBareUrlPrefix(v) {
  const t = (v || '').trim().toLowerCase();
  return !t || t === 'https://' || t === 'http://';
}

function normalizeUrlLine(line) {
  const t = (line || '').trim();
  if (isBareUrlPrefix(t)) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return URL_PREFIX + t.replace(/^\/+/, '');
}

function normalizeUrlListText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeUrlLine(line))
    .filter(Boolean)
    .join('\n');
}

function readUrlField(id) {
  return normalizeUrlLine($(id)?.value || '');
}

function setupUrlInputs() {
  const fields = ['input-url', 'input-sitemap-seed'];
  fields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (!el.value.trim()) el.value = URL_PREFIX;
    el.addEventListener('focus', () => {
      if (isBareUrlPrefix(el.value)) {
        el.value = URL_PREFIX;
        el.setSelectionRange(URL_PREFIX.length, URL_PREFIX.length);
      }
    });
    el.addEventListener('blur', () => {
      if (isBareUrlPrefix(el.value)) el.value = URL_PREFIX;
    });
  });

  const list = $('input-url-list');
  if (list && !list.value.trim()) list.value = URL_PREFIX;
}

function getPayload() {
  const mode = document.querySelector('input[name="inspect-mode"]:checked')?.value || 'single';
  const mobile = $('input-mobile')?.checked !== false;
  if (mode === 'list') {
    return {
      mode: 'list',
      urlList: normalizeUrlListText($('input-url-list').value),
      mobile,
      maxPages: 50,
    };
  }
  if (mode === 'sitemap') {
    const url = readUrlField('input-sitemap-seed') || readUrlField('input-url');
    return {
      mode: 'sitemap',
      url,
      mobile,
      maxPages: Number($('input-max-pages').value) || 20,
    };
  }
  return {
    url: readUrlField('input-url'),
    mobile,
    mode: 'single',
  };
}

function setupModePanels() {
  document.querySelectorAll('input[name="inspect-mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      const mode = el.value;
      $('panel-single').hidden = mode !== 'single';
      $('panel-list').hidden = mode !== 'list';
      $('panel-sitemap').hidden = mode !== 'sitemap';
    });
  });
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

function formatCompareOption(r, isBatch) {
  const at = formatShortDate(r.completedAt || r.createdAt);
  if (isBatch) {
    const failPg = r.summary?.failPages ?? 0;
    const pages = r.summary?.pages ?? 0;
    return `${at} — ${failPg}pg fail / ${pages}p`;
  }
  const fail = r.summary?.fail ?? 0;
  const pass = r.summary?.pass ?? 0;
  return `${at} — fail ${fail}, pass ${pass}`;
}

function renderDiffPanel(run, diffOverride, compareMeta = {}) {
  const panel = $('diff-panel');
  const diff = diffOverride ?? run.diff;
  if (!diff) {
    panel.hidden = true;
    return;
  }

  const comparedLabel = compareMeta.previousRunId
    ? ` · ${formatShortDate(compareMeta.previousAt)} 점검과 비교`
    : run.previousRunId && !compareMeta.manual
      ? ' · 직전 점검과 비교'
      : compareMeta.manual
        ? ' · 선택한 점검과 비교'
        : '';

  if (run.type === 'batch') {
    const regressed = (diff.pages || []).filter((p) => p.type === 'regressed' || (p.type === 'new' && p.fail > 0));
    const improved = (diff.pages || []).filter((p) => p.type === 'improved');
    panel.hidden = false;
    panel.className = `diff-panel diff-inline ${regressed.length ? '' : 'ok'}`;
    panel.innerHTML = `
      <h3>${regressed.length ? `새로 실패한 페이지 ${regressed.length}개` : '새로 실패한 페이지 없음'}${comparedLabel}</h3>
      ${
        regressed.length
          ? `<ul class="diff-list">${regressed
              .slice(0, 8)
              .map((p) => `<li>${escapeHtml(p.url)} — 실패 ${p.prevFail ?? 0} → ${p.curFail ?? p.fail}</li>`)
              .join('')}</ul>`
          : '<p class="mb-0 text-muted">이전 점검보다 실패가 늘어난 페이지가 없습니다.</p>'
      }
      ${
        improved.length
          ? `<p class="diff-fixed mb-0 mt-2">나아진 페이지 ${improved.length}개</p>`
          : ''
      }`;
    return;
  }

  const { newFails, fixed, hasRegression } = diff;
  panel.hidden = false;
  panel.className = `diff-panel diff-inline ${hasRegression ? '' : 'ok'}`;
  const fixedNote =
    fixed.length > 0 ? ` (이전에 실패했던 항목 ${fixed.length}개는 통과로 바뀜)` : '';
  panel.innerHTML = `
    <h3>${hasRegression ? `이전보다 새로 실패 ${newFails.length}건` : `새 실패 없음${fixedNote}`}${comparedLabel}</h3>
    ${
      newFails.length
        ? `<ul class="diff-list">${newFails
            .slice(0, 10)
            .map((f) => `<li>[${f.viewport}] ${escapeHtml(f.title)}</li>`)
            .join('')}</ul>`
        : '<p class="mb-0 text-muted">이전 점검에는 없던 실패가 없습니다. (원래부터 실패였던 항목은 여기에 안 나옵니다)</p>'
    }
    ${
      fixed.length
        ? `<p class="diff-fixed mb-0 mt-2">고친 항목 ${fixed.length}개: ${fixed
            .slice(0, 5)
            .map((f) => escapeHtml(f.title))
            .join(', ')}${fixed.length > 5 ? '…' : ''}</p>`
        : ''
    }`;
}

function renderTrendChart(trend, currentRunId) {
  const chart = $('trend-chart');
  const sub = $('trend-sub');
  if (!trend?.points?.length) {
    chart.innerHTML = '<p class="trend-empty mb-0">같은 URL의 완료 run이 2회 이상이면 표시됩니다.</p>';
    sub.textContent = '최근 10회';
    return;
  }

  const isBatch = trend.matchType === 'batch';
  sub.textContent = isBatch ? `최근 ${trend.points.length}회 · 페이지 fail/pass` : `최근 ${trend.points.length}회`;

  const maxTotal = Math.max(...trend.points.map((p) => (p.pass || 0) + (p.fail || 0)), 1);
  const stackH = 96;

  chart.innerHTML = trend.points
    .map((p) => {
      const total = (p.pass || 0) + (p.fail || 0) || 1;
      const passH = Math.round(((p.pass || 0) / maxTotal) * stackH);
      const failH = Math.round(((p.fail || 0) / maxTotal) * stackH);
      const minSeg = p.fail > 0 || p.pass > 0 ? 2 : 0;
      const failStyle = p.fail > 0 ? `height:${Math.max(failH, minSeg)}px` : 'height:0';
      const passStyle = p.pass > 0 ? `height:${Math.max(passH, minSeg)}px` : 'height:0';
      const runHref = p.id === currentRunId ? '#' : `?run=${p.id}`;
      const failLabel =
        p.fail > 0
          ? `<a href="${runHref}" class="trend-fail-link" title="fail ${p.fail}">${p.fail}</a>`
          : `<span class="trend-date" style="color:#22c55e">0</span>`;
      return `<div class="trend-col ${p.isCurrent ? 'current' : ''}" title="${escapeHtml(p.at)}">
        <div class="trend-stack" style="height:${stackH}px">
          <div class="trend-seg pass" style="${passStyle}"></div>
          <div class="trend-seg fail" style="${failStyle}"></div>
        </div>
        <span class="trend-date">${formatShortDate(p.at).split(' ')[0]}</span>
        ${failLabel}
      </div>`;
    })
    .join('');
}

function populateCompareSelect(comparable, run, defaultId) {
  const select = $('compare-select');
  const isBatch = run.type === 'batch';
  if (!comparable.length) {
    select.innerHTML = '<option value="">비교할 이전 run 없음</option>';
    select.disabled = true;
    $('btn-compare-apply').disabled = true;
    return;
  }
  select.disabled = false;
  $('btn-compare-apply').disabled = false;
  select.innerHTML = comparable
    .map((r) => {
      const selected = r.id === defaultId ? ' selected' : '';
      return `<option value="${r.id}"${selected}>${escapeHtml(formatCompareOption(r, isBatch))}</option>`;
    })
    .join('');
  compareSelection = defaultId || comparable[0]?.id || '';
}

async function applyCompare(run) {
  const compareTo = $('compare-select').value;
  if (!compareTo || !run?.id) {
    renderDiffPanel(run, null);
    $('diff-panel').hidden = true;
    return;
  }
  compareSelection = compareTo;
  try {
    const res = await fetch(`${API}/runs/${run.id}/diff?compareTo=${encodeURIComponent(compareTo)}`);
    if (!res.ok) {
      throw new Error(res.status === 404 ? '비교 API 없음 — 서버 재시작 필요' : `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok || !data.diff) {
      renderDiffPanel(run, null);
      $('diff-panel').hidden = true;
      return;
    }
    const prevRes = await fetch(`${API}/runs/${compareTo}`);
    const prevData = await prevRes.json();
    let previousAt = data.diff.previousAt || prevData.run?.completedAt;
    renderDiffPanel(run, data.diff, {
      previousRunId: compareTo,
      previousAt,
      manual: compareTo !== run.previousRunId,
    });
    updateProcessFlow(4);
  } catch (_) {
    setStatus('비교 결과를 불러오지 못했습니다.', 'error');
  }
}

async function loadInsights(run) {
  const panel = $('insights-panel');
  if (!run?.id || run.status !== 'completed') {
    panel.hidden = true;
    insightsRunId = null;
    return;
  }

  insightsRunId = run.id;
  panel.hidden = false;

  const match = getRunMatchLabel(run);
  $('compare-sub').textContent = match;
  $('trend-sub').textContent = '불러오는 중…';
  $('compare-select').innerHTML = '<option value="">로딩…</option>';
  $('compare-select').disabled = true;

  try {
    const [compRes, trendRes] = await Promise.all([
      fetch(`${API}/runs/${run.id}/comparable`),
      fetch(`${API}/runs/${run.id}/trend?limit=10`),
    ]);

    if (insightsRunId !== run.id) return;

    if (!compRes.ok || !trendRes.ok) {
      const needRestart = compRes.status === 404 || trendRes.status === 404;
      const msg = needRestart
        ? '비교·추이 API가 없습니다. 서버를 재시작한 뒤 페이지를 새로고침하세요.'
        : '비교·추이를 불러오지 못했습니다.';
      $('trend-chart').innerHTML = `<p class="trend-empty mb-0">${escapeHtml(msg)}</p>`;
      $('compare-select').innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
      $('btn-compare-apply').disabled = true;
      if (run.diff) {
        renderDiffPanel(run, run.diff, { previousRunId: run.previousRunId, manual: false });
      } else {
        $('diff-panel').hidden = true;
      }
      setStatus(msg, 'error');
      return;
    }

    const compData = await compRes.json();
    const trendData = await trendRes.json();

    if (insightsRunId !== run.id) return;

    if (!compData.ok || !trendData.ok) {
      throw new Error(compData.error || trendData.error || 'API 오류');
    }

    const comparable = compData.runs || [];
    const defaultCompare = compareSelection && comparable.some((r) => r.id === compareSelection)
      ? compareSelection
      : run.previousRunId && comparable.some((r) => r.id === run.previousRunId)
        ? run.previousRunId
        : comparable[0]?.id;

    populateCompareSelect(comparable, run, defaultCompare);

    if (defaultCompare) {
      await applyCompare(run);
    } else if (run.diff) {
      renderDiffPanel(run, run.diff, { previousRunId: run.previousRunId, manual: false });
    } else {
      $('diff-panel').hidden = true;
    }

    renderTrendChart(trendData, run.id);
  } catch (err) {
    $('trend-chart').innerHTML = `<p class="trend-empty mb-0">${escapeHtml(err.message || '추이 로드 실패')}</p>`;
    $('compare-select').innerHTML = '<option value="">로드 실패</option>';
    $('btn-compare-apply').disabled = true;
    if (run.diff) {
      renderDiffPanel(run, run.diff, { previousRunId: run.previousRunId, manual: false });
    }
  }
}

function getRunMatchLabel(run) {
  if (run.type === 'batch') {
    const seed = run.input?.seedUrl || run.input?.urls?.[0] || '';
    return seed ? seed.replace(/^https?:\/\//, '').slice(0, 40) : '배치';
  }
  const url = run.input?.url || '';
  return url.replace(/^https?:\/\//, '').slice(0, 48) || 'URL';
}

function renderBatchPages(run) {
  const el = $('batch-pages');
  if (run.type !== 'batch' || !run.pages?.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const detailId = new URLSearchParams(location.search).get('detail');
  el.innerHTML = `
    <p class="batch-hint">행 또는 「상세」를 클릭하면 아래에 점검 항목 전체를 볼 수 있습니다.</p>
    <table class="batch-table">
      <thead><tr><th>URL</th><th>Pass</th><th>Fail</th><th></th></tr></thead>
      <tbody>
        ${run.pages
          .map(
            (p) => `<tr class="clickable-row ${p.summary?.fail ? 'fail-row' : ''} ${detailId === p.runId ? 'detail-active' : ''}" data-run-id="${p.runId}">
              <td class="text-truncate" style="max-width:280px" title="${escapeHtml(p.url)}">${escapeHtml(p.url)}</td>
              <td>${p.summary?.pass ?? 0}</td>
              <td>${p.summary?.fail ?? 0}</td>
              <td><button type="button" class="btn-detail-link" data-run-id="${p.runId}">상세</button></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;

  el.querySelectorAll('.clickable-row').forEach((row) => {
    const runId = row.dataset.runId;
    if (!runId) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-detail-link')) return;
      e.preventDefault();
      openPageDetail(runId);
    });
  });
  el.querySelectorAll('.btn-detail-link').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPageDetail(btn.dataset.runId);
    });
  });
}

async function openPageDetail(pageRunId) {
  if (!pageRunId) return;
  try {
    const res = await fetch(`${API}/runs/${pageRunId}`);
    const data = await res.json();
    if (!data.ok || !data.run) return;

    const pageRun = data.run;
    lastRun = pageRun;
    currentRunId = pageRunId;

    const batchId = batchViewRun?.id || pageRun.input?.parentBatchId;
    if (batchId) {
      history.replaceState(null, '', `?run=${batchId}&detail=${pageRunId}`);
    } else {
      history.replaceState(null, '', `?run=${pageRunId}`);
    }

    $('batch-detail-bar').hidden = false;
    $('batch-detail-url').textContent = pageRun.input?.url || '';
    $('page-detail-summary').hidden = false;

    const s = pageRun.summary || { pass: 0, fail: 0, skip: 0 };
    const failCount = s.fail || 0;
    $('page-detail-summary').className = `summary-strip page-detail-summary ${failCount ? 'warn' : 'ok'}`;
    $('page-detail-summary').innerHTML = `
      <div class="summary-strip-main">
        <div class="summary-strip-title">${failCount ? `${failCount}개 항목 실패` : '모든 항목 통과'}</div>
        <div class="summary-strip-sub">이 페이지 · ${(s.pass || 0) + failCount + (s.skip || 0)}개 점검</div>
      </div>
      <div class="summary-metrics">
        <div class="metric pass"><div class="metric-num">${s.pass || 0}</div><div class="metric-label">Pass</div></div>
        <div class="metric fail"><div class="metric-num">${failCount}</div><div class="metric-label">Fail</div></div>
        <div class="metric skip"><div class="metric-num">${s.skip || 0}</div><div class="metric-label">Skip</div></div>
      </div>`;

    const toolbar = document.querySelector('.toolbar');
    if (toolbar) toolbar.hidden = false;

    if (pageRun.evidence?.screenshot) {
      $('screenshot-wrap').hidden = false;
      $('screenshot-img').src = `${API}/runs/${pageRunId}/screenshot?t=${Date.now()}`;
    } else {
      $('screenshot-wrap').hidden = true;
    }

    renderResultsList(pageRun);
    await loadIssueDashboard(pageRun);
    highlightBatchRow(pageRunId);
    await loadInsights(pageRun);
    $('page-detail-summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (_) {
    setStatus('상세 결과를 불러오지 못했습니다.', 'error');
  }
}

function closePageDetail() {
  if (!batchViewRun) return;
  lastRun = batchViewRun;
  currentRunId = batchViewRun.id;
  history.replaceState(null, '', `?run=${batchViewRun.id}`);
  $('batch-detail-bar').hidden = true;
  $('page-detail-summary').hidden = true;
  $('screenshot-wrap').hidden = true;
  $('results-list').innerHTML = '';
  $('results-empty').hidden = true;
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) toolbar.hidden = true;
  highlightBatchRow(null);
  renderBatchPages(batchViewRun);
  loadInsights(batchViewRun);
}

function highlightBatchRow(runId) {
  document.querySelectorAll('.batch-table tbody tr').forEach((tr) => {
    tr.classList.toggle('detail-active', runId && tr.dataset.runId === runId);
  });
}

function renderResultsList(run) {
  const results = (run.results || []).filter(matchesResultFilter);
  const groups = groupByCategory(run.results || [], 'category');

  if (results.length === 0) {
    $('results-list').innerHTML = '';
    $('results-empty').hidden = false;
  } else {
    $('results-empty').hidden = true;
    $('results-list').innerHTML = groups
      .map((g) => {
        const visible = g.items.filter(matchesResultFilter);
        if (visible.length === 0) return '';
        const gPass = g.items.filter((r) => r.status === 'pass').length;
        const gFail = g.items.filter((r) => r.status === 'fail').length;
        const gSkip = g.items.filter((r) => r.status === 'skip').length;
        const openByDefault = gFail > 0 || resultFilter !== 'all';
        return `<details class="result-category ${gFail ? 'has-fail' : ''}" ${openByDefault ? 'open' : ''}>
          <summary class="result-category-header">
            <span class="result-category-title">${categoryLabel(g.category)}</span>
            <span class="result-category-counts">
              ${gPass ? `<span class="count-pill pass">${gPass}</span>` : ''}
              ${gFail ? `<span class="count-pill fail">${gFail}</span>` : ''}
              ${gSkip ? `<span class="count-pill skip">${gSkip}</span>` : ''}
            </span>
          </summary>
          ${visible.map(renderResultItem).join('')}
        </details>`;
      })
      .join('');
  }
}

function matchesResultFilter(r) {
  if (hideSkip && r.status === 'skip') return false;
  if (dashboardLaneFilter && r.status === 'fail' && laneForCategory(r.category) !== dashboardLaneFilter) {
    return false;
  }
  if (resultFilter === 'all') return true;
  if (resultFilter === 'fail') return r.status === 'fail';
  if (resultFilter === 'issues') {
    return r.status === 'fail' && (r.severity === 'blocker' || r.severity === 'major');
  }
  return true;
}

async function loadIssueDashboard(run) {
  const panel = $('issue-dashboard-panel');
  const el = $('issue-dashboard');
  if (!panel || !el || !run?.id || run.status !== 'completed') {
    if (panel) panel.hidden = true;
    return;
  }
  try {
    const res = await fetch(`${API}/runs/${run.id}/dashboard`);
    const data = await res.json();
    if (!data.ok || !data.dashboard) {
      panel.hidden = true;
      return;
    }
    renderIssueDashboard(run, data.dashboard);
    panel.hidden = false;
    updateProcessFlow(detectProcessStep());
  } catch (_) {
    panel.hidden = true;
  }
}

function renderIssueDashboard(run, dash) {
  const el = $('issue-dashboard');
  if (!el) return;

  if (dash.mode === 'batch') {
    const regressedNote = dash.hasRegression
      ? `<p class="dashboard-note warn">이전 대비 새로 깨진 페이지·항목이 있습니다. 아래 배치 표와 비교 패널을 확인하세요.</p>`
      : `<p class="dashboard-note ok">이전 대비 새 회귀 없음 (전체 fail ${dash.totalFail}건은 참고용)</p>`;
    el.innerHTML = `
      ${regressedNote}
      <div class="dashboard-batch-metrics">
        <div class="dash-metric"><span class="dash-metric-num">${dash.failPages}</span><span class="dash-metric-label">실패 페이지</span></div>
        <div class="dash-metric"><span class="dash-metric-num">${dash.passPages}</span><span class="dash-metric-label">통과 페이지</span></div>
        <div class="dash-metric"><span class="dash-metric-num">${dash.totalFail}</span><span class="dash-metric-label">총 fail 항목</span></div>
      </div>
      ${
        dash.topIssues?.length
          ? `<h4 class="dashboard-subtitle">실패 페이지</h4><ul class="dashboard-issue-list">${dash.topIssues
              .map(
                (i) =>
                  `<li><button type="button" class="dashboard-issue-link" data-page-run="${i.runId || ''}">${escapeHtml(i.title)}</button><span class="dashboard-issue-evidence">${escapeHtml(i.evidence || '')}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="empty-msg mb-0">실패한 페이지가 없습니다.</p>'
      }`;
    el.querySelectorAll('[data-page-run]').forEach((btn) => {
      const id = btn.dataset.pageRun;
      if (!id) return;
      btn.addEventListener('click', () => openPageDetail(id));
    });
    return;
  }

  if (!dash.totalFail) {
    el.innerHTML = '<p class="dashboard-empty ok mb-0">동작·코드·보안·접근성 점검에서 실패 항목이 없습니다.</p>';
    return;
  }

  const laneCards = (dash.lanes || [])
    .map(
      (lane) => `
      <button type="button" class="dashboard-lane ${lane.fail ? 'has-fail' : ''}" data-lane="${lane.id}" ${lane.fail ? '' : 'disabled'}>
        <span class="dashboard-lane-label">${escapeHtml(lane.label)}</span>
        <span class="dashboard-lane-count">${lane.fail}</span>
        <span class="dashboard-lane-hint">${escapeHtml(lane.hint)}</span>
      </button>`,
    )
    .join('');

  el.innerHTML = `
    <div class="dashboard-lanes">${laneCards}</div>
    <h4 class="dashboard-subtitle">오류 목록 (중요도 순)</h4>
    <ul class="dashboard-issue-list" id="dashboard-top-issues">
      ${(dash.topIssues || [])
        .map(
          (i) =>
            `<li class="dashboard-issue-row" data-lane="${i.lane}">
              <span class="severity-tag ${severityBadgeClass(i.severity)}">${severityLabel(i.severity)}</span>
              <span class="dashboard-issue-lane">${escapeHtml(i.laneLabel)}</span>
              <strong>${escapeHtml(i.title)}</strong>
              ${i.viewport ? `<span class="dashboard-viewport">[${escapeHtml(i.viewport)}]</span>` : ''}
              <span class="dashboard-issue-evidence">${escapeHtml((i.evidence || '').slice(0, 120))}${(i.evidence || '').length > 120 ? '…' : ''}</span>
            </li>`,
        )
        .join('')}
    </ul>
    <p class="dashboard-foot">공정별 필터 · <button type="button" class="btn-link-inline" id="btn-clear-lane-filter">필터 해제</button></p>`;

  el.onclick = (e) => {
    if (e.target.closest('#btn-clear-lane-filter')) {
      dashboardLaneFilter = null;
      if (lastRun) renderResultsList(lastRun);
      return;
    }
  };

  el.querySelectorAll('.dashboard-lane.has-fail').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboardLaneFilter = btn.dataset.lane;
      resultFilter = 'fail';
      $('filter-fail').checked = true;
      if (lastRun) renderResultsList(lastRun);
      $('results-list')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  el.querySelectorAll('.dashboard-issue-row').forEach((row) => {
    row.addEventListener('click', () => {
      dashboardLaneFilter = row.dataset.lane;
      resultFilter = 'fail';
      $('filter-fail').checked = true;
      if (lastRun) renderResultsList(lastRun);
      $('results-list')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

async function loadExperiencePanel() {
  const el = $('experience-checklists');
  if (!el) return;
  try {
    const res = await fetchWithTimeout(`${API}/checklists`, {}, 8000);
    const data = await res.json();
    if (!data.ok) throw new Error('load failed');
    const lists = data.checklists || [];
    if (!lists.length) {
      el.innerHTML = '<p class="empty-msg mb-0">체크리스트가 없습니다.</p>';
      return;
    }
    el.innerHTML = lists
      .slice(0, 6)
      .map((c) => {
        const n = (c.items || []).length;
        const auto = (c.items || []).filter((i) => i.inspectType === 'playwright' || i.inspectType === 'ai_code').length;
        return `<div class="experience-item">
          <div class="experience-name">${escapeHtml(c.name)}</div>
          <div class="experience-meta">${n}항목 · 자동화 ${auto} · ${c.kind === 'basic' ? '기본' : '선택'}</div>
        </div>`;
      })
      .join('');
  } catch (_) {
    el.innerHTML = '<p class="empty-msg mb-0">체크리스트를 불러오지 못했습니다.</p>';
  }
}

function renderResultItem(r) {
  return `<div class="result-item ${r.status}">
    <div class="result-item-head">
      <div>
        <span class="result-item-title">${escapeHtml(r.title)}</span>
        <span class="severity-tag ${severityBadgeClass(r.severity)}">${severityLabel(r.severity)}</span>
      </div>
      <span class="status-pill ${r.status}">${statusLabel(r.status)}</span>
    </div>
    <div class="result-item-evidence">${escapeHtml(r.evidence || '')}</div>
    ${r.suggestion ? `<div class="result-item-tip">${escapeHtml(r.suggestion)}</div>` : ''}
  </div>`;
}

function renderResults(run) {
  lastRun = run;
  const isBatch = run.type === 'batch';
  const s = run.summary || { pass: 0, fail: 0, skip: 0 };
  const failCount = isBatch ? s.failPages ?? 0 : s.fail || 0;

  if (isBatch) {
    batchViewRun = run;
    $('batch-detail-bar').hidden = true;
    $('page-detail-summary').hidden = true;
  } else {
    batchViewRun = run.input?.parentBatchId ? batchViewRun : null;
  }

  if (isBatch) {
    $('result-url').textContent = `${run.input?.mode === 'sitemap' ? 'Sitemap' : 'URL 목록'} · ${run.pages?.length || 0}페이지`;
  } else {
    $('result-url').textContent = run.input?.url || run.evidence?.url || '';
  }

  $('result-duration').textContent = run.evidence?.duration
    ? `${(run.evidence.duration / 1000).toFixed(1)}초`
    : '';

  $('summary-strip').className = `summary-strip ${failCount ? 'warn' : 'ok'}`;
  $('summary-strip').innerHTML = isBatch
    ? `<div class="summary-strip-main">
        <div class="summary-strip-title">${failCount ? `${failCount}페이지 실패` : '모든 페이지 통과'}</div>
        <div class="summary-strip-sub">${run.pages?.length || 0}페이지 · 총 fail ${s.fail || 0}건</div>
      </div>
      <div class="summary-metrics">
        <div class="metric pass"><div class="metric-num">${s.passPages || 0}</div><div class="metric-label">OK</div></div>
        <div class="metric fail"><div class="metric-num">${failCount}</div><div class="metric-label">Fail pg</div></div>
        <div class="metric skip"><div class="metric-num">${s.fail || 0}</div><div class="metric-label">Fail chk</div></div>
      </div>`
    : `<div class="summary-strip-main">
        <div class="summary-strip-title">${failCount ? `${failCount}개 항목 실패` : '모든 항목 통과'}</div>
        <div class="summary-strip-sub">총 ${(s.pass || 0) + failCount + (s.skip || 0)}개${run.input?.viewports?.includes('mobile') ? ' · 데스크톱+모바일' : ''}</div>
      </div>
      <div class="summary-metrics">
        <div class="metric pass"><div class="metric-num">${s.pass || 0}</div><div class="metric-label">Pass</div></div>
        <div class="metric fail"><div class="metric-num">${failCount}</div><div class="metric-label">Fail</div></div>
        <div class="metric skip"><div class="metric-num">${s.skip || 0}</div><div class="metric-label">Skip</div></div>
      </div>`;

  renderBatchPages(run);

  if (run.status === 'completed') {
    loadInsights(run);
    loadIssueDashboard(run);
  } else {
    $('insights-panel').hidden = true;
    $('issue-dashboard-panel').hidden = true;
  }

  updateProcessFlow(detectProcessStep());

  const toolbar = document.querySelector('.toolbar');

  if (isBatch) {
    if (toolbar) toolbar.hidden = true;
    $('results-list').innerHTML = '';
    $('results-empty').hidden = true;
    $('screenshot-wrap').hidden = true;
  } else {
    if (toolbar) toolbar.hidden = false;
    if (run.evidence?.screenshot) {
      $('screenshot-wrap').hidden = false;
      $('screenshot-img').src = `${API}/runs/${run.id}/screenshot?t=${Date.now()}`;
    } else {
      $('screenshot-wrap').hidden = true;
    }
    renderResultsList(run);
  }

  $('results-section').hidden = false;
  highlightRecentRun(run.id);
}

async function startInspect() {
  $('btn-start').disabled = true;
  autoFilterApplied = false;
  resultFilter = 'all';
  dashboardLaneFilter = null;
  $('filter-all').checked = true;
  updateProcessFlow(2);
  const onCloud = $('deploy-banner') && !$('deploy-banner').hidden;
  setStatus(onCloud ? '점검 중입니다… (클라우드에서는 최대 1분 걸릴 수 있습니다)' : '점검을 시작합니다…', 'loading');
  $('progress-section').hidden = false;
  $('results-section').hidden = true;
  $('insights-panel').hidden = true;
  $('issue-dashboard-panel').hidden = true;
  $('diff-panel').hidden = true;
  $('spinner').hidden = false;
  $('progress-label').textContent = '점검 중…';

  try {
    const res = await fetchWithTimeout(
      `${API}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPayload()),
      },
      120000,
    );
    if (!res.ok) {
      let msg = `서버 오류 (HTTP ${res.status})`;
      try {
        const errBody = await res.json();
        msg = (errBody.errors || [errBody.error]).filter(Boolean).join(' ') || msg;
      } catch (_) {
        /* non-JSON */
      }
      setStatus(msg, 'error');
      $('progress-section').hidden = true;
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      setStatus((data.errors || [data.error]).join(' '), 'error');
      $('progress-section').hidden = true;
      return;
    }
    currentRunId = data.runId;
    history.replaceState(null, '', `?run=${data.runId}`);

    if (data.run) {
      cacheRunLocally(data.run);
      renderLogs(data.run.logs);
    }

    if (data.run && (data.run.status === 'completed' || data.run.status === 'failed')) {
      await applyFinishedRun(data.run);
      loadRecentRuns();
      return;
    }

    setStatus('점검 중입니다…', 'loading');
    startPolling();
    loadRecentRuns();
  } catch (err) {
    const msg =
      err.name === 'AbortError'
        ? '점검 시간이 초과되었습니다. 다시 시도해 주세요.'
        : err.message || '점검 요청 실패';
    setStatus(msg, 'error');
    $('progress-section').hidden = true;
  } finally {
    $('btn-start').disabled = false;
  }
}

function renderLogs(logs) {
  $('log-list').innerHTML = (logs || [])
    .slice(-20)
    .map((l) => `<li>${l.at.slice(11, 19)} ${escapeHtml(l.message)}</li>`)
    .join('');
}

function cacheRunLocally(run) {
  if (!run?.id) return;
  try {
    sessionStorage.setItem(`cg-run-${run.id}`, JSON.stringify(run));
  } catch (_) {
    /* quota */
  }
}

function loadCachedRun(runId) {
  try {
    const raw = sessionStorage.getItem(`cg-run-${runId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

async function applyFinishedRun(run) {
  stopPolling();
  $('spinner').hidden = true;
  $('progress-label').textContent = run.status === 'completed' ? '완료' : '실패';
  const failCount = run.type === 'batch' ? run.summary?.failPages || 0 : run.summary?.fail || 0;
  if (failCount > 0 && !autoFilterApplied && run.type !== 'batch') {
    autoFilterApplied = true;
    resultFilter = 'fail';
    $('filter-fail').checked = true;
  }
  renderResults(run);
  if (run.type === 'batch') {
    const detailId = new URLSearchParams(location.search).get('detail');
    if (detailId) await openPageDetail(detailId);
    setStatus(
      run.summary?.failPages
        ? `완료 — ${run.summary.failPages}페이지 실패`
        : '완료 — 배치 점검 완료',
      run.summary?.failPages ? 'error' : 'success',
    );
  } else {
    setStatus(
      run.status === 'completed'
        ? failCount
          ? `${failCount}개 항목 실패`
          : '모든 항목 통과'
        : run.error || '점검 실패',
      failCount ? 'error' : 'success',
    );
  }
}

async function pollRun() {
  if (!currentRunId) return;
  try {
    const res = await fetchWithTimeout(`${API}/runs/${currentRunId}`, {}, 15000);
    const data = await res.json();
    if (!data.ok || !data.run) {
      pollMissCount += 1;
      const cached = loadCachedRun(currentRunId);
      if (cached && (cached.status === 'completed' || cached.status === 'failed')) {
        renderLogs(cached.logs);
        await applyFinishedRun(cached);
        return;
      }
      if (pollMissCount >= 6) {
        stopPolling();
        $('spinner').hidden = true;
        setStatus(
          '점검 결과를 서버에서 찾지 못했습니다. 같은 탭에서 점검을 다시 시도해 주세요.',
          'error',
        );
      }
      return;
    }
    pollMissCount = 0;
    const run = data.run;
    cacheRunLocally(run);
    renderLogs(run.logs);

    if (run.status === 'completed' || run.status === 'failed') {
      await applyFinishedRun(run);
    }
  } catch (_) {
    pollMissCount += 1;
  }
}

function startPolling() {
  stopPolling();
  pollMissCount = 0;
  pollTimer = setInterval(pollRun, 1000);
  pollRun();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function highlightRecentRun(runId) {
  document.querySelectorAll('.recent-run-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.runId === runId);
  });
}

async function loadRecentRuns() {
  try {
    const res = await fetchWithTimeout(`${API}/runs?limit=8`, {}, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const activeId = currentRunId || new URLSearchParams(location.search).get('run');
    $('recent-runs').innerHTML =
      (data.runs || [])
        .map((r) => {
          const fail = r.summary?.fail ?? 0;
          const isBatch = r.type === 'batch';
          const label = isBatch
            ? `batch ${r.summary?.failPages ?? 0}pg fail`
            : r.status === 'completed'
              ? fail > 0
                ? `Fail ${fail}`
                : 'Pass'
              : r.status;
          const pillClass = !isBatch && r.status === 'completed' && fail === 0 ? 'pass' : fail > 0 ? 'fail' : 'skip';
          const displayUrl = isBatch
            ? `${r.input?.mode || 'batch'} · ${r.pages?.length || r.input?.urls?.length || 0}p`
            : r.input?.url || '(URL 없음)';
          return `<li class="recent-run-item ${activeId === r.id ? 'active' : ''}" data-run-id="${r.id}">
            <a href="?run=${r.id}">
              <div class="recent-run-url">${escapeHtml(displayUrl)}</div>
              <div class="recent-run-meta">
                <span class="status-pill ${pillClass}">${label}</span>
              </div>
            </a>
          </li>`;
        })
        .join('') || '<li class="empty-msg">아직 없음</li>';
  } catch (_) {
    $('recent-runs').innerHTML =
      '<li class="empty-msg">최근 점검 없음 (클라우드는 재배포 시 기록이 사라질 수 있음)</li>';
  }
}

async function openRunFromQuery() {
  const params = new URLSearchParams(location.search);
  const runId = params.get('run');
  const detailId = params.get('detail');
  if (!runId) return;

  currentRunId = runId;
  $('progress-section').hidden = false;
  const res = await fetchWithTimeout(`${API}/runs/${runId}`, {}, 15000);
  const data = await res.json();
  let run = data.ok && data.run ? data.run : loadCachedRun(runId);
  if (!run) return;
  if (data.run) cacheRunLocally(run);

  if (run.type === 'batch') {
    batchViewRun = run;
    $('input-url').value = run.input?.seedUrl || run.input?.urls?.[0] || '';
    if (run.status === 'running' || run.status === 'queued') {
      $('spinner').hidden = false;
      $('progress-label').textContent = '점검 중…';
      startPolling();
      return;
    }
    $('spinner').hidden = true;
    $('progress-label').textContent = '완료';
    renderLogs(run.logs);
    renderResults(run);
    if (detailId) await openPageDetail(detailId);
    return;
  }

  $('input-url').value = run.input?.url || '';
  if (run.input?.parentBatchId) {
    const batchRes = await fetch(`${API}/runs/${run.input.parentBatchId}`);
    const batchData = await batchRes.json();
    if (batchData.ok && batchData.run?.type === 'batch') {
      batchViewRun = batchData.run;
      renderLogs(batchData.run.logs);
      renderResults(batchData.run);
      if (run.status === 'completed' || run.status === 'failed') {
        await openPageDetail(run.id);
      }
      return;
    }
  }

  if (run.status === 'running' || run.status === 'queued') {
    $('spinner').hidden = false;
    $('progress-label').textContent = '점검 중…';
    startPolling();
  } else {
    $('spinner').hidden = true;
    $('progress-label').textContent = '완료';
    renderLogs(run.logs);
    renderResults(run);
    const failCount = run.summary?.fail || 0;
    setStatus(failCount ? `${failCount}개 항목 실패` : '모든 항목 통과', failCount ? 'error' : 'success');
  }
  highlightRecentRun(runId);
}

$('btn-back-batch').addEventListener('click', closePageDetail);

$('compare-select').addEventListener('change', () => {
  compareSelection = $('compare-select').value;
  if (lastRun?.status === 'completed') applyCompare(lastRun);
});

$('btn-compare-apply').addEventListener('click', () => {
  if (lastRun?.status === 'completed') applyCompare(lastRun);
});

document.querySelectorAll('input[name="filter-status"]').forEach((el) => {
  el.addEventListener('change', () => {
    resultFilter = el.value;
    if (el.value !== 'fail') dashboardLaneFilter = null;
    if (lastRun && lastRun.type !== 'batch') renderResultsList(lastRun);
    else if (lastRun && batchViewRun) openPageDetail(lastRun.id);
  });
});

$('hide-skip').addEventListener('change', (e) => {
  hideSkip = e.target.checked;
  if (lastRun && lastRun.type !== 'batch') renderResultsList(lastRun);
  else if (lastRun && batchViewRun) openPageDetail(lastRun.id);
});

$('checks-search').addEventListener('input', (e) => {
  renderChecksList(allChecks, e.target.value);
});

$('btn-start').addEventListener('click', startInspect);
$('input-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startInspect();
});

async function loadDeployBanner() {
  try {
    const res = await fetchWithTimeout(`${API}/meta`, {}, 8000);
    const data = await res.json();
    if (!data.ok || !data.vercel) return;
    const el = $('deploy-banner');
    el.hidden = false;
    el.textContent =
      data.limits?.note ||
      '클라우드 배포 모드: 점검이 끝날 때까지 기다려 주세요(최대 약 60초). 이전 점검 기록은 서버 재시작 시 사라질 수 있습니다.';
    if (data.limits?.mobileDefault === false) {
      $('input-mobile').checked = false;
    }
  } catch (_) {
    /* optional */
  }
}

loadChecksList();
loadExperiencePanel();
loadRecentRuns();
loadDeployBanner();
setupModePanels();
setupUrlInputs();
updateProcessFlow(1);
openRunFromQuery();
