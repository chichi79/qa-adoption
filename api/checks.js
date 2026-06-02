/** GET /api/checks — Express cold start 없이 항목 목록만 반환 */
module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { BUILTIN_CHECKS } = require('../lib/url-inspector');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ ok: true, checks: BUILTIN_CHECKS });
};
