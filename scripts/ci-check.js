#!/usr/bin/env node
/**
 * CheckGate CI — URL 목록 또는 sitemap 배치 점검
 *
 * Usage:
 *   node scripts/ci-check.js --urls checkgate-urls.txt
 *   node scripts/ci-check.js --url https://example.com --sitemap --max-pages 15
 *   CHECKGATE_URLS="https://a.com\nhttps://b.com" node scripts/ci-check.js
 *
 * Exit 1: fail 항목 또는 회귀(new fail) 존재
 */
const fs = require('fs');
const path = require('path');
const { inspectUrl } = require('../lib/url-inspector');
const { crawlSitemap, parseUrlList, validateUrls } = require('../lib/sitemap-crawler');
const { normalizeViewports } = require('../lib/viewports');
const { diffRuns } = require('../lib/run-diff');
const { findPreviousRun, saveRun, createRunId, summarizeResults } = require('../lib/run-store');

function parseArgs(argv) {
  const args = { urls: [], url: '', sitemap: false, maxPages: 20, mobile: true, failOnRegression: true };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--urls' && argv[i + 1]) {
      args.urlsFile = argv[++i];
    } else if (a === '--url' && argv[i + 1]) {
      args.url = argv[++i];
    } else if (a === '--sitemap') {
      args.sitemap = true;
    } else if (a === '--max-pages' && argv[i + 1]) {
      args.maxPages = Number(argv[++i]) || 20;
    } else if (a === '--no-mobile') {
      args.mobile = false;
    } else if (a === '--no-fail-on-regression') {
      args.failOnRegression = false;
    } else if (a === '--help') {
      args.help = true;
    }
  }
  if (process.env.CHECKGATE_URLS) {
    args.urls = parseUrlList(process.env.CHECKGATE_URLS);
  }
  if (process.env.CHECKGATE_URL) {
    args.url = process.env.CHECKGATE_URL;
  }
  return args;
}

async function resolveUrls(args) {
  if (args.urlsFile) {
    const text = fs.readFileSync(path.resolve(args.urlsFile), 'utf8');
    return validateUrls(parseUrlList(text).slice(0, args.maxPages)).valid;
  }
  if (args.urls?.length) {
    return validateUrls(args.urls.slice(0, args.maxPages)).valid;
  }
  if (args.sitemap && args.url) {
    const { urls } = await crawlSitemap({ seedUrl: args.url, maxPages: args.maxPages });
    return urls;
  }
  if (args.url) return [args.url];
  return [];
}

async function inspectOne(url, viewports) {
  const runId = createRunId();
  const out = await inspectUrl({
    url,
    resultsDir: path.join(__dirname, '..', 'test-results', 'ci', runId),
    options: { viewports },
  });
  const run = {
    id: runId,
    type: 'single',
    status: 'completed',
    input: { url, viewports },
    results: out.results,
    summary: summarizeResults(out.results),
    completedAt: new Date().toISOString(),
  };
  saveRun(run);
  const previous = findPreviousRun({ url, beforeId: runId, type: 'single' });
  const diff = previous ? diffRuns(previous, run) : null;
  return { url, run, out, diff };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('CheckGate CI — node scripts/ci-check.js --urls urls.txt [--no-mobile]');
    process.exit(0);
  }

  const urls = await resolveUrls(args);
  if (!urls.length) {
    console.error('URL이 없습니다. --url, --urls, --sitemap 또는 CHECKGATE_URLS를 지정하세요.');
    process.exit(2);
  }

  const viewports = normalizeViewports(args.mobile ? ['desktop', 'mobile'] : ['desktop']);
  console.log(`CheckGate CI — ${urls.length} URL, viewports: ${viewports.join(', ')}`);

  let totalFail = 0;
  let totalRegression = 0;

  for (const url of urls) {
    console.log(`\n▶ ${url}`);
    const { summary, diff } = await inspectOne(url, viewports);
    const fail = summary.fail || 0;
    totalFail += fail;
    console.log(`  pass ${summary.pass} / fail ${fail} / skip ${summary.skip}`);
    if (diff?.hasRegression) {
      totalRegression += diff.summary.newFail;
      console.log(`  ⚠ 회귀: 새 실패 ${diff.summary.newFail}건 (이전 run ${diff.previousRunId})`);
      diff.newFails.slice(0, 5).forEach((f) => {
        console.log(`    - [${f.viewport}] ${f.title}: ${f.evidence}`);
      });
    }
  }

  console.log(`\n총 fail ${totalFail}, 회귀 ${totalRegression}`);
  const shouldFail = totalFail > 0 || (args.failOnRegression && totalRegression > 0);
  process.exit(shouldFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
