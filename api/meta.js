/** GET /api/meta */
module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const fs = require('fs');
  const path = require('path');
  const { isVercel } = require('../lib/paths');

  let chromiumBin = null;
  if (isVercel) {
    try {
      const bin = path.join(
        path.dirname(require.resolve('@sparticuz/chromium/package.json')),
        'bin',
      );
      chromiumBin = fs.readdirSync(bin);
    } catch (_) {
      chromiumBin = ['unavailable'];
    }
  }

  res.status(200).json({
    ok: true,
    vercel: isVercel,
    nodeVersion: process.version,
    browserFix: 'libnss-v4-node20',
    chromiumPkg: isVercel
      ? require('@sparticuz/chromium/package.json').version
      : null,
    chromiumBin,
    deployRev: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    limits: isVercel
      ? {
          maxBatchPages: 5,
          mobileDefault: false,
          mobileSupported: true,
          note: '클라우드: 모바일 선택 시 데스크톱+모바일 점검(최대 약 60초). run 기록은 임시 저장됩니다.',
        }
      : { maxBatchPages: 50, mobileDefault: true, note: null },
  });
};
