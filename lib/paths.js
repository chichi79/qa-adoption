const path = require('path');
const fs = require('fs');
const os = require('os');

const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);

/** Run JSON 저장 (Vercel: /tmp, 로컬: data/runs) */
const RUNS_DIR = isVercel
  ? path.join(os.tmpdir(), 'checkgate-runs')
  : path.join(__dirname, '..', 'data', 'runs');

/** 스크린샷 등 (Vercel: /tmp) */
const RESULTS_ROOT = isVercel
  ? path.join(os.tmpdir(), 'checkgate-results')
  : path.join(__dirname, '..', 'test-results');

function ensureDataDirs() {
  for (const dir of [RUNS_DIR, RESULTS_ROOT]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = { isVercel, RUNS_DIR, RESULTS_ROOT, ensureDataDirs };
