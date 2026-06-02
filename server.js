const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { runPlaywright } = require('./lib/playwright-runner');
const { runElementPicker } = require('./lib/element-picker');
const { discoverStepsFromUrl } = require('./lib/auto-discover-steps');
const { generateFromNaturalLanguageMulti, generateFromSpecContent } = require('./lib/tc-generator');
const { extractTextFromFile } = require('./lib/extract-spec-text');
const { buildPreview, startRun } = require('./lib/inspect-worker');
const { getRun, listRuns, listComparableRuns, getRunTrend, getRunMatchKey } = require('./lib/run-store');
const { diffRuns, diffBatchPages } = require('./lib/run-diff');
const { BUILTIN_CHECKS } = require('./lib/url-inspector');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_CDP_URL = process.env.PLAYWRIGHT_CDP_URL || 'http://localhost:9222';

/**
 * Edge CDP(CDP 포트)에 이미 연결 가능한지 확인
 */
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
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * npm start 시:
 * - Edge 디버깅 모드(CDP)가 켜져 있지 않으면 launch-edge-debug.ps1 통해 자동 실행
 */
async function ensureEdgeDebugSession() {
  const available = await isCdpAvailable(DEFAULT_CDP_URL);
  if (available) {
    console.log(`[CDP] 기존 Edge 디버깅 세션이 감지되었습니다: ${DEFAULT_CDP_URL}`);
    return;
  }

  try {
    // 1차 시도: Node에서 직접 Edge 실행 (PowerShell 의존 제거)
    let edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (!fs.existsSync(edgePath)) {
      edgePath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    }

    if (fs.existsSync(edgePath)) {
      const userDataDir = path.join(os.tmpdir(), 'edge-debug-profile');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      const port = 9222;
      console.log(`[CDP] Edge(msedge)를 포트 ${port} 디버깅 모드로 직접 실행합니다...`);
      const child = spawn(
        edgePath,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${userDataDir}`,
          '--no-first-run',
          '--no-default-browser-check',
        ],
        {
          detached: true,
          stdio: 'ignore',
        },
      );
      child.unref();
      return;
    }

    console.warn('[CDP] Edge 실행 파일(msedge.exe)을 기본 경로에서 찾지 못했습니다. PowerShell 스크립트로 재시도합니다.');

    // 2차 시도: 기존 PowerShell 스크립트 사용 (fallback)
    const scriptPath = path.join(__dirname, 'launch-edge-debug.ps1');
    if (!fs.existsSync(scriptPath)) {
      console.warn('[CDP] launch-edge-debug.ps1 스크립트를 찾을 수 없습니다. Edge는 자동으로 실행되지 않습니다.');
      return;
    }

    console.log('[CDP] PowerShell을 통해 Edge 디버깅 모드를 실행합니다...');
    const psChild = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    psChild.unref();
  } catch (err) {
    console.warn('[CDP] Edge 디버깅 모드 자동 실행에 실패했습니다:', err.message || err);
  }
}

// 업로드 디렉터리 (기획서 업로드용)
const uploadDir = path.join(__dirname, 'uploads');
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// URL 점검 API (1차)
app.get('/api/checks', (req, res) => {
  res.json({ ok: true, checks: BUILTIN_CHECKS });
});

app.get('/api/meta', (req, res) => {
  res.json({
    ok: true,
    vercel: isVercel,
    limits: isVercel
      ? { maxBatchPages: 5, mobileDefault: false, note: '점검 완료까지 최대 약 60초. run 기록은 임시 저장됩니다.' }
      : { maxBatchPages: 50, mobileDefault: true, note: null },
  });
});

app.post('/api/runs/preview', (req, res) => {
  try {
    const preview = buildPreview(req.body || {});
    if (!preview.ok) {
      return res.status(400).json(preview);
    }
    res.json({ ok: true, ...preview });
  } catch (err) {
    console.error('runs/preview error:', err);
    res.status(500).json({ ok: false, errors: [err.message || '미리보기 실패'] });
  }
});

app.post('/api/runs', async (req, res) => {
  try {
    const result = await startRun(req.body || {});
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, runId: result.runId, run: result.run });
  } catch (err) {
    console.error('runs create error:', err);
    res.status(500).json({ ok: false, errors: [err.message || 'Run 생성 실패'] });
  }
});

app.get('/api/runs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json({ ok: true, runs: listRuns(limit) });
});

app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Run을 찾을 수 없습니다.' });
  }
  res.json({ ok: true, run });
});

app.get('/api/runs/:id/comparable', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Run을 찾을 수 없습니다.' });
  }
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  res.json({
    ok: true,
    runs: listComparableRuns(req.params.id, limit),
    currentRunId: run.id,
    matchKey: getRunMatchKey(run)?.key || null,
  });
});

app.get('/api/runs/:id/trend', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Run을 찾을 수 없습니다.' });
  }
  const limit = Math.min(Number(req.query.limit) || 10, 30);
  res.json({ ok: true, ...getRunTrend(req.params.id, limit) });
});

app.get('/api/runs/:id/diff', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ ok: false, error: 'Run을 찾을 수 없습니다.' });
  }

  const compareTo = req.query.compareTo;
  if (compareTo) {
    const previous = getRun(compareTo);
    if (!previous) {
      return res.status(404).json({ ok: false, error: '비교 대상 Run을 찾을 수 없습니다.' });
    }
    const diff =
      run.type === 'batch'
        ? { ...diffBatchPages(previous.pages, run.pages), hasPrevious: true, previousRunId: compareTo }
        : diffRuns(previous, run);
    return res.json({ ok: true, diff, previousRunId: compareTo, compareTo });
  }

  if (run.diff) {
    return res.json({ ok: true, diff: run.diff, previousRunId: run.previousRunId });
  }
  if (run.previousRunId) {
    const previous = getRun(run.previousRunId);
    const diff =
      run.type === 'batch'
        ? diffBatchPages(previous?.pages, run.pages)
        : diffRuns(previous, run);
    return res.json({ ok: true, diff, previousRunId: run.previousRunId });
  }
  return res.json({ ok: true, diff: null, message: '비교할 이전 Run이 없습니다.' });
});

app.get('/api/runs/:id/screenshot', (req, res) => {
  const run = getRun(req.params.id);
  if (!run?.evidence?.screenshot || !fs.existsSync(run.evidence.screenshot)) {
    return res.status(404).json({ ok: false, error: '스크린샷 없음' });
  }
  res.sendFile(path.resolve(run.evidence.screenshot));
});

// GUI — URL 점검
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 기획서 업로드 → TC 추출 (TXT/MD 직접 파싱, PDF/DOCX는 텍스트 추출 후 파싱)
app.post('/api/upload-spec', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '파일이 없습니다.' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const baseURL = (req.body && req.body.baseURL) ? req.body.baseURL.trim() : '';

  let content = '';
  try {
    if (ext === '.txt' || ext === '.md') {
      content = fs.readFileSync(req.file.path, 'utf8');
    } else if (ext === '.pdf' || ext === '.docx' || ext === '.doc') {
      content = await extractTextFromFile(req.file.path, ext);
      if (!content || !content.trim()) {
        return res.json({
          success: true,
          filename: req.file.originalname,
          message: '텍스트를 추출할 수 없었습니다. (스캔된 이미지 PDF는 지원하지 않습니다.)',
          testCases: [],
        });
      }
    } else {
      return res.json({
        success: true,
        filename: req.file.originalname,
        message: 'TXT, MD, PDF, DOCX 파일만 자동 TC 추출이 가능합니다.',
        testCases: [],
      });
    }
  } catch (err) {
    console.error('upload-spec read error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || '파일을 읽는 중 오류가 발생했습니다.',
      testCases: [],
    });
  }

  try {
    const testCases = generateFromSpecContent(content, baseURL);
    res.json({
      success: true,
      filename: req.file.originalname,
      message: `업로드 완료. ${testCases.length}개 스텝으로 TC를 생성했습니다.`,
      testCases,
    });
  } catch (err) {
    console.error('upload-spec generate error:', err);
    res.status(500).json({
      success: false,
      error: 'TC 생성 중 오류가 발생했습니다.',
      testCases: [],
    });
  }
});

// 자연어 → TC 생성 (규칙 기반 파싱)
app.post('/api/generate-tc', (req, res) => {
  const { naturalLanguage, baseURL } = req.body || {};
  if (!naturalLanguage || !naturalLanguage.trim()) {
    return res.status(400).json({ error: '자연어 입력이 없습니다.' });
  }
  const url = baseURL && baseURL.trim() ? baseURL.trim() : '';
  const testCases = generateFromNaturalLanguageMulti(naturalLanguage.trim(), url);
  res.json({
    success: true,
    message: `${testCases.length}개 스텝으로 TC를 생성했습니다. 필요 시 아래를 수정한 뒤 테스트 실행하세요.`,
    testCases,
  });
});

// 요소 선택기(픽커): 대상 페이지에서 클릭한 요소의 selector/text 반환
app.post('/api/picker-pick', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !url.trim()) {
    return res.status(400).json({ success: false, error: '대상 페이지 URL을 입력해 주세요.' });
  }
  try {
    const result = await runElementPicker({ url: url.trim() });
    res.json({ success: true, selector: result.selector, text: result.text });
  } catch (err) {
    console.error('Picker error:', err);
    res.status(500).json({
      success: false,
      error: err.message || '요소 선택 중 오류가 발생했습니다.',
    });
  }
});

// URL만 주면 페이지 분석 후 규칙으로 스텝 자동 생성 (input → fill, submit/버튼 → click, 링크 최대 5개)
app.post('/api/auto-discover-steps', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !url.trim()) {
    return res.status(400).json({ success: false, error: '대상 페이지 URL을 입력해 주세요.', testCases: [] });
  }
  try {
    const { steps, pageType } = await discoverStepsFromUrl({ url: url.trim() });
    const { PAGE_TYPE_LABELS } = require('./lib/auto-discover-steps');
    const typeLabel = PAGE_TYPE_LABELS[pageType] || pageType;
    res.json({
      success: true,
      message: `페이지를 분석해 ${steps.length}개 스텝을 생성했습니다. (감지된 성격: ${typeLabel}) 필요 시 아래를 수정한 뒤 테스트 실행하세요.`,
      testCases: steps,
      pageType: pageType,
      pageTypeLabel: typeLabel,
    });
  } catch (err) {
    console.error('Auto-discover error:', err);
    res.status(500).json({
      success: false,
      error: err.message || '자동 스텝 생성 중 오류가 발생했습니다.',
      testCases: [],
    });
  }
});

// Playwright 테스트 실행
app.post('/api/run-test', async (req, res) => {
  const { url, testCases } = req.body || {};
  if (!url || !url.trim()) {
    return res.status(400).json({ error: '대상 페이지 URL을 입력해주세요.' });
  }
  try {
    const result = await runPlaywright({
      baseURL: url.trim(),
      steps: Array.isArray(testCases) && testCases.length > 0
        ? testCases
        : [{ action: 'goto', url: url.trim() }, { action: 'screenshot', name: 'home' }],
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Playwright run error:', err);
    res.status(500).json({
      success: false,
      error: err.message || '테스트 실행 중 오류가 발생했습니다.',
    });
  }
});

// 서버 시작 전 uploads 폴더 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const { isVercel, ensureDataDirs } = require('./lib/paths');
ensureDataDirs();

module.exports = app;

if (!isVercel && require.main === module) {
  ensureEdgeDebugSession().catch((err) => {
    console.warn('[CDP] Edge 디버깅 세션 보장 로직 오류:', err && err.message ? err.message : err);
  });

  app.listen(PORT, () => {
    console.log(`CheckGate: http://localhost:${PORT}`);
    console.log(`Legacy TC GUI: http://localhost:${PORT}/legacy/index.html`);
    console.log(`Playwright CDP 대상: ${DEFAULT_CDP_URL}`);
  });
}
