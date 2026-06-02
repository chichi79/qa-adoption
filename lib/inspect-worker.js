const path = require('path');
const { inspectUrl, BUILTIN_CHECKS } = require('./url-inspector');
const { crawlSitemap, parseUrlList, validateUrls } = require('./sitemap-crawler');
const { normalizeViewports } = require('./viewports');
const { diffRuns, diffBatchPages } = require('./run-diff');
const {
  saveRun,
  getRun,
  summarizeResults,
  createRunId,
  createBatchId,
  findPreviousRun,
  aggregateBatchSummary,
} = require('./run-store');

const { RESULTS_ROOT, isVercel } = require('./paths');

function validateUrlInput(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return { ok: false, errors: ['점검 URL을 입력해 주세요.'] };
  try {
    new URL(trimmed);
  } catch (_) {
    return { ok: false, errors: ['URL 형식이 올바르지 않습니다.'] };
  }
  return { ok: true, url: trimmed };
}

function buildPreview(body) {
  const v = validateUrlInput(body.url);
  if (!v.ok) return v;
  return {
    ok: true,
    url: v.url,
    checks: BUILTIN_CHECKS,
    checkCount: BUILTIN_CHECKS.length,
  };
}

function buildInspectOptions(body) {
  const mobileDefault = isVercel ? false : body.mobile !== false;
  const viewports = normalizeViewports(
    body.mobile === false || isVercel
      ? ['desktop']
      : body.viewports || ['desktop', 'mobile'],
  );
  return {
    maxLinks: Math.min(Number(body.maxLinks) || 15, isVercel ? 5 : 30),
    viewports,
    mobile: mobileDefault,
  };
}

async function executeRun(runId) {
  const run = getRun(runId);
  if (!run) return;

  const log = (message) => {
    run.logs.push({ at: new Date().toISOString(), message });
    saveRun(run);
  };

  try {
    run.status = 'running';
    run.phase = 'inspecting';
    saveRun(run);
    log('CheckGate 점검 시작');

    const resultsDir = path.join(RESULTS_ROOT, run.id);
    const inspectOptions = buildInspectOptions(run.input);
    const out = await inspectUrl({
      url: run.input.url,
      resultsDir,
      options: inspectOptions,
    });

    run.results = out.results;
    run.evidence = {
      screenshot: out.evidence.screenshot,
      duration: out.duration,
      status: out.evidence.status,
      title: out.evidence.title,
      viewports: out.viewports,
    };
    run.summary = summarizeResults(out.results);
    run.status = 'completed';
    run.phase = 'done';
    run.error = out.error || null;
    if (out.error && (run.summary?.skip || 0) >= 40 && (run.summary?.pass || 0) === 0) {
      log(`점검 오류(대부분 SKIP): ${out.error}`);
    }
    run.completedAt = new Date().toISOString();

    const previous = findPreviousRun({ url: run.input.url, beforeId: run.id, type: 'single' });
    if (previous) {
      run.diff = diffRuns(previous, run);
      run.previousRunId = previous.id;
      if (run.diff.hasRegression) {
        log(`새 실패 감지: ${run.diff.summary.newFail}건 (이전 점검 대비)`);
      }
    }

    const failCount = run.summary?.fail || 0;
    if (out.error) {
      log(`점검 실패: ${out.error}`);
    } else if (failCount > 0) {
      log(`점검 완료 — ${failCount}개 항목 실패`);
    } else {
      log('점검 완료');
    }
    saveRun(run);
  } catch (err) {
    run.status = 'failed';
    run.error = err.message || String(err);
    run.completedAt = new Date().toISOString();
    log(`실패: ${run.error}`);
    saveRun(run);
  }
}

async function executeBatchRun(batchId) {
  const batch = getRun(batchId);
  if (!batch || batch.type !== 'batch') return;

  const log = (message) => {
    batch.logs.push({ at: new Date().toISOString(), message });
    saveRun(batch);
  };

  try {
    batch.status = 'running';
    batch.phase = 'batch';
    saveRun(batch);
    log(`배치 점검 시작 (${batch.input.urls.length} URL)`);

    const inspectOptions = buildInspectOptions(batch.input);
    batch.pages = [];

    for (let i = 0; i < batch.input.urls.length; i += 1) {
      const pageUrl = batch.input.urls[i];
      log(`[${i + 1}/${batch.input.urls.length}] ${pageUrl}`);

      const childId = createRunId();
      const childDir = path.join(RESULTS_ROOT, batchId, `page-${i + 1}`);
      const out = await inspectUrl({ url: pageUrl, resultsDir: childDir, options: inspectOptions });

      const child = {
        id: childId,
        type: 'single',
        status: 'completed',
        input: { url: pageUrl, ...batch.input, parentBatchId: batchId },
        results: out.results,
        summary: summarizeResults(out.results),
        evidence: { duration: out.duration, title: out.evidence.title, viewports: out.viewports },
        completedAt: new Date().toISOString(),
      };
      saveRun(child);

      batch.pages.push({
        url: pageUrl,
        runId: childId,
        summary: child.summary,
        fail: child.summary.fail,
      });
      saveRun(batch);
    }

    batch.summary = aggregateBatchSummary(batch.pages);
    batch.status = 'completed';
    batch.completedAt = new Date().toISOString();

    const previous = findPreviousRun({
      url: batch.input.seedUrl || batch.input.urls[0],
      beforeId: batch.id,
      type: 'batch',
    });
    if (previous?.pages) {
      batch.diff = {
        ...diffBatchPages(previous.pages, batch.pages),
        hasPrevious: true,
        previousRunId: previous.id,
      };
      batch.previousRunId = previous.id;
      if (batch.diff.hasRegression) log('이전보다 실패가 늘어난 페이지 있음');
    }

    log(`배치 완료 — ${batch.summary.failPages}페이지 실패`);
    saveRun(batch);
  } catch (err) {
    batch.status = 'failed';
    batch.error = err.message || String(err);
    batch.completedAt = new Date().toISOString();
    log(`배치 실패: ${batch.error}`);
    saveRun(batch);
  }
}

async function resolveBatchUrls(body) {
  const mode = body.mode || 'single';
  const maxPages = Math.min(Number(body.maxPages) || 20, 50);

  if (mode === 'list') {
    const lines = Array.isArray(body.urls) ? body.urls : parseUrlList(body.urlList);
    const { valid, errors } = validateUrls(lines.slice(0, maxPages));
    if (!valid.length) return { ok: false, errors: errors.length ? errors : ['URL 목록이 비어 있습니다.'] };
    return { ok: true, urls: valid, mode: 'list', seedUrl: valid[0] };
  }

  if (mode === 'sitemap') {
    const v = validateUrlInput(body.url || body.seedUrl);
    if (!v.ok) return v;
    const crawled = await crawlSitemap({ seedUrl: v.url, maxPages });
    if (!crawled.urls.length) return { ok: false, errors: ['sitemap에서 URL을 찾지 못했습니다.'] };
    return {
      ok: true,
      urls: crawled.urls,
      mode: 'sitemap',
      seedUrl: v.url,
      sitemapUrl: crawled.sitemapUrl,
    };
  }

  const v = validateUrlInput(body.url);
  if (!v.ok) return v;
  return { ok: true, urls: [v.url], mode: 'single', seedUrl: v.url };
}

function startRun(body) {
  return resolveBatchUrls(body).then((resolved) => {
    if (!resolved.ok) return resolved;

    if (resolved.mode === 'single' && resolved.urls.length === 1 && !body.forceBatch) {
      const inspectOpts = buildInspectOptions(body);
      const runId = createRunId();
      const run = {
        id: runId,
        type: 'single',
        status: 'queued',
        phase: 'queued',
        input: {
          url: resolved.urls[0],
          maxLinks: inspectOpts.maxLinks,
          viewports: inspectOpts.viewports,
          mobile: inspectOpts.mobile,
        },
        preview: { checks: BUILTIN_CHECKS, checkCount: BUILTIN_CHECKS.length },
        results: [],
        evidence: null,
        logs: [{ at: new Date().toISOString(), message: 'Run 생성됨' }],
        summary: null,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      saveRun(run);
      if (isVercel) {
        return executeRun(runId).then(() => ({ ok: true, runId, run: getRun(runId) }));
      }
      setImmediate(() => executeRun(runId));
      return { ok: true, runId, run };
    }

    if (isVercel && resolved.urls.length > 5) {
      return {
        ok: false,
        errors: ['Vercel 배포에서는 URL 목록·Sitemap 최대 5페이지까지 지원합니다.'],
      };
    }

    const batchOpts = buildInspectOptions(body);
    const batchId = createBatchId();
    const batch = {
      id: batchId,
      type: 'batch',
      status: 'queued',
      phase: 'queued',
      input: {
        mode: resolved.mode,
        seedUrl: resolved.seedUrl,
        sitemapUrl: resolved.sitemapUrl || null,
        urls: resolved.urls,
        maxPages: resolved.urls.length,
        viewports: batchOpts.viewports,
        mobile: batchOpts.mobile,
      },
      pages: [],
      results: [],
      evidence: null,
      logs: [{ at: new Date().toISOString(), message: 'Batch Run 생성됨' }],
      summary: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    saveRun(batch);
    if (isVercel) {
      return executeBatchRun(batchId).then(() => ({
        ok: true,
        runId: batchId,
        run: getRun(batchId),
      }));
    }
    setImmediate(() => executeBatchRun(batchId));
    return { ok: true, runId: batchId, run: batch };
  });
}

module.exports = { buildPreview, startRun, executeRun, executeBatchRun, resolveBatchUrls };
