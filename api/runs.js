/** GET 목록 · POST 점검 (Express 위임 없이 — Vercel async 대기 보장) */
require('../lib/paths');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const { listRunsSummary } = require('../lib/run-store');
    const limit = Math.min(Number(req.query?.limit) || 20, 100);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, runs: listRunsSummary(limit) });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { startRun } = require('../lib/inspect-worker');
      const result = await startRun(body || {});
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.status(200).json({ ok: true, runId: result.runId, run: result.run });
    } catch (err) {
      console.error('[api/runs POST]', err);
      res.status(500).json({
        ok: false,
        error: err.message || 'Run 생성 실패',
        errors: [err.message || 'Run 생성 실패'],
      });
    }
    return;
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
};
