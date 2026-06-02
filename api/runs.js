/** GET /api/runs — 가벼운 목록 (POST 등은 Express로 위임) */
module.exports = (req, res) => {
  if (req.method === 'GET') {
    const { listRunsSummary } = require('../lib/run-store');
    const limit = Math.min(Number(req.query?.limit) || 20, 100);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, runs: listRunsSummary(limit) });
  }
  return require('../server')(req, res);
};
