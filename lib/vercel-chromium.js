const fs = require('fs');
const path = require('path');

/** Vercel Fluid Compute — @sparticuz/chromium AL2023 lib 추출 (libnss3.so) */
const AL2023_LIB = '/tmp/al2023/lib';
const AL2023_LIBNSS = path.join(AL2023_LIB, 'libnss3.so');

async function ensureAl2023Libraries() {
  if (fs.existsSync(AL2023_LIBNSS)) {
    return AL2023_LIB;
  }

  const pkgRoot = path.dirname(require.resolve('@sparticuz/chromium/package.json'));
  const al2023Br = path.join(pkgRoot, 'bin', 'al2023.tar.br');
  if (!fs.existsSync(al2023Br)) {
    throw new Error(
      'Chromium AL2023 libraries not bundled (al2023.tar.br missing). Check Vercel includeFiles.',
    );
  }

  const lambdafs = require('@sparticuz/chromium/build/lambdafs').default;
  await lambdafs.inflate(al2023Br);

  if (!fs.existsSync(AL2023_LIBNSS)) {
    throw new Error('Chromium AL2023 extract finished but libnss3.so was not found.');
  }
  return AL2023_LIB;
}

function applyLibraryPath(executablePath, libDir) {
  const { setupLambdaEnvironment } = require('@sparticuz/chromium/build/helper');
  setupLambdaEnvironment(libDir);

  const execDir = path.dirname(executablePath);
  const parts = [libDir, execDir, '/tmp', process.env.LD_LIBRARY_PATH || '']
    .flatMap((p) => String(p).split(':'))
    .filter(Boolean);
  process.env.LD_LIBRARY_PATH = [...new Set(parts)].join(':');
}

module.exports = { ensureAl2023Libraries, applyLibraryPath, AL2023_LIB };
