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

/** 기획서 업로드 (Vercel: /tmp) */
const UPLOADS_DIR = isVercel
  ? path.join(os.tmpdir(), 'checkgate-uploads')
  : path.join(__dirname, '..', 'uploads');

function ensureDataDirs() {
  for (const dir of [RUNS_DIR, RESULTS_ROOT, UPLOADS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = { isVercel, RUNS_DIR, RESULTS_ROOT, UPLOADS_DIR, ensureDataDirs };
