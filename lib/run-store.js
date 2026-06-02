const fs = require('fs');
const path = require('path');
const { RUNS_DIR, ensureDataDirs } = require('./paths');

function ensureRunsDir() {
  ensureDataDirs();
}

/** 비교·추이 매칭용 URL 정규화 (trailing slash, hash 제거) */
function normalizeUrlKey(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    u.hash = '';
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return u.href;
  } catch (_) {
    return trimmed.replace(/\/+$/, '') || trimmed;
  }
}

function runPath(id) {
  return path.join(RUNS_DIR, `${id}.json`);
}

function createRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBatchId() {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveRun(run) {
  ensureRunsDir();
  fs.writeFileSync(runPath(run.id), JSON.stringify(run, null, 2), 'utf8');
}

function getRun(id) {
  const file = runPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadAllRuns() {
  ensureRunsDir();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')));
}

function listRuns(limit = 20) {
  return loadAllRuns()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function findPreviousRun({ url, beforeId, type = 'single' }) {
  const norm = normalizeUrlKey(url);
  const runs = loadAllRuns()
    .filter((r) => r.id !== beforeId && r.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (type === 'batch') {
    return (
      runs.find((r) => r.type === 'batch' && normalizeUrlKey(r.input?.seedUrl) === norm) ||
      null
    );
  }

  return (
    runs.find(
      (r) => r.type !== 'batch' && normalizeUrlKey(r.input?.url) === norm,
    ) ||
    runs.find((r) => !r.type && normalizeUrlKey(r.input?.url) === norm) ||
    null
  );
}

function getRunMatchKey(run) {
  if (!run) return null;
  if (run.type === 'batch') {
    const key = run.input?.seedUrl || run.input?.urls?.[0];
    return key ? { type: 'batch', key: normalizeUrlKey(key) } : null;
  }
  const url = run.input?.url;
  return url ? { type: 'single', key: normalizeUrlKey(url) } : null;
}

function matchesRunKey(run, match) {
  const k = getRunMatchKey(run);
  return !!(k && match && k.type === match.type && k.key === match.key);
}

function runTimestamp(run) {
  return new Date(run.completedAt || run.createdAt).getTime();
}

function listComparableRuns(runId, limit = 25) {
  const run = getRun(runId);
  if (!run || run.status !== 'completed') return [];
  const match = getRunMatchKey(run);
  if (!match) return [];

  return loadAllRuns()
    .filter((r) => r.id !== runId && r.status === 'completed' && matchesRunKey(r, match))
    .sort((a, b) => runTimestamp(b) - runTimestamp(a))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      summary: r.summary,
      type: r.type,
    }));
}

function getRunTrend(runId, limit = 10) {
  const run = getRun(runId);
  if (!run) return { matchKey: null, matchType: null, points: [] };
  const match = getRunMatchKey(run);
  if (!match) return { matchKey: null, matchType: null, points: [] };

  const points = loadAllRuns()
    .filter((r) => r.status === 'completed' && matchesRunKey(r, match))
    .sort((a, b) => runTimestamp(a) - runTimestamp(b))
    .slice(-limit)
    .map((r) => {
      const isBatch = match.type === 'batch';
      return {
        id: r.id,
        at: r.completedAt || r.createdAt,
        pass: isBatch ? r.summary?.passPages ?? 0 : r.summary?.pass ?? 0,
        fail: isBatch ? r.summary?.failPages ?? 0 : r.summary?.fail ?? 0,
        skip: r.summary?.skip ?? 0,
        isCurrent: r.id === runId,
      };
    });

  return { matchKey: match.key, matchType: match.type, points };
}

function summarizeResults(results) {
  const summary = { pass: 0, fail: 0, skip: 0, pending: 0, manual_pending: 0 };
  for (const r of results) {
    if (r.status === 'pass') summary.pass += 1;
    else if (r.status === 'fail') summary.fail += 1;
    else if (r.status === 'skip') summary.skip += 1;
    else if (r.status === 'pending' && r.inspectType === 'manual') {
      summary.manual_pending += 1;
      summary.pending += 1;
    } else summary.pending += 1;
  }
  return summary;
}

function aggregateBatchSummary(pages) {
  const summary = { pass: 0, fail: 0, skip: 0, pages: pages.length, failPages: 0, passPages: 0 };
  for (const p of pages) {
    summary.pass += p.summary?.pass || 0;
    summary.fail += p.summary?.fail || 0;
    summary.skip += p.summary?.skip || 0;
    if ((p.summary?.fail || 0) > 0) summary.failPages += 1;
    else summary.passPages += 1;
  }
  return summary;
}

module.exports = {
  RUNS_DIR,
  createRunId,
  createBatchId,
  saveRun,
  getRun,
  listRuns,
  findPreviousRun,
  normalizeUrlKey,
  getRunMatchKey,
  listComparableRuns,
  getRunTrend,
  summarizeResults,
  aggregateBatchSummary,
};
