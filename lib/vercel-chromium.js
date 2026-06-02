const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = os.tmpdir();

function walkFind(dir, name, depth) {
  if (depth < 0 || !dir || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === name) return full;
    if (ent.isDirectory() && !ent.name.startsWith('playwright_chromiumdev')) {
      const hit = walkFind(full, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findLibFile(name) {
  return walkFind(TMP, name, 8);
}

async function inflateArchive(binDir, name) {
  const br = path.join(binDir, name);
  if (!fs.existsSync(br)) return false;
  const lambdafs = require('@sparticuz/chromium/build/lambdafs').default;
  await lambdafs.inflate(br);
  return true;
}

function copySharedLibsToTmp(libDir) {
  if (!libDir || !fs.existsSync(libDir)) return;
  for (const name of fs.readdirSync(libDir)) {
    if (!/\.so(\.|$)/.test(name)) continue;
    const src = path.join(libDir, name);
    const dest = path.join(TMP, name);
    try {
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    } catch (_) {
      /* ignore copy races on warm starts */
    }
  }
}

function buildLaunchEnv(ldPath) {
  return {
    ...process.env,
    LD_LIBRARY_PATH: ldPath,
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH || path.join(TMP, 'fonts'),
    HOME: process.env.HOME || TMP,
  };
}

function applyLibPaths(libDir, executablePath) {
  const execDir = path.dirname(executablePath);
  const ldParts = [
    TMP,
    libDir,
    execDir,
    '/tmp/al2023/lib',
    '/tmp/al2/lib',
    process.env.LD_LIBRARY_PATH || '',
  ]
    .flatMap((p) => String(p).split(':'))
    .filter(Boolean);
  const ldPath = [...new Set(ldParts)].join(':');
  process.env.LD_LIBRARY_PATH = ldPath;

  try {
    const { setupLambdaEnvironment } = require('@sparticuz/chromium/build/helper');
    setupLambdaEnvironment(libDir);
  } catch (_) {
    /* helper optional */
  }

  return buildLaunchEnv(ldPath);
}

/**
 * Vercel Fluid Compute — libnss3.so 추출·/tmp 복사·LD_LIBRARY_PATH
 * @returns {{ executablePath: string, launchEnv: Record<string, string> }}
 */
async function prepareServerlessChromium(chromiumPkg) {
  process.env.AWS_LAMBDA_JS_RUNTIME ??= 'nodejs22.x';
  process.env.FONTCONFIG_PATH ??= path.join(TMP, 'fonts');
  process.env.HOME ??= TMP;

  chromiumPkg.setGraphicsMode = false;

  const pkgRoot = path.dirname(require.resolve('@sparticuz/chromium/package.json'));
  const binDir = path.join(pkgRoot, 'bin');
  if (!fs.existsSync(binDir)) {
    throw new Error(`@sparticuz/chromium bin/ missing (Vercel includeFiles 확인)`);
  }

  const nodeMajor = parseInt(String(process.versions.node).split('.')[0], 10) || 20;
  let libnss = findLibFile('libnss3.so');

  if (!libnss) {
    if (nodeMajor >= 20 || process.env.VERCEL) {
      await inflateArchive(binDir, 'al2023.tar.br');
    }
    libnss = findLibFile('libnss3.so');
  }

  if (!libnss) {
    await inflateArchive(binDir, 'al2.tar.br');
    libnss = findLibFile('libnss3.so');
  }

  const executablePath = await chromiumPkg.executablePath();

  if (!libnss) {
    libnss = findLibFile('libnss3.so');
  }

  if (!libnss) {
    const binList = fs.readdirSync(binDir).join(', ');
    throw new Error(
      `libnss3.so not found (node ${process.version}, bin: ${binList}). Vercel Node 20+ 권장.`,
    );
  }

  const libDir = path.dirname(libnss);
  copySharedLibsToTmp(libDir);
  const launchEnv = applyLibPaths(libDir, executablePath);

  return { executablePath, launchEnv, libDir };
}

module.exports = { prepareServerlessChromium, findLibFile };
