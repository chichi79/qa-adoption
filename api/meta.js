/** GET /api/meta */
module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { isVercel } = require('../lib/paths');
  res.status(200).json({
    ok: true,
    vercel: isVercel,
    browserFix: 'headless-bool-v2',
    deployRev: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    limits: isVercel
      ? { maxBatchPages: 5, mobileDefault: false, note: '점검 완료까지 최대 약 60초. run 기록은 임시 저장됩니다.' }
      : { maxBatchPages: 50, mobileDefault: true, note: null },
  });
};
