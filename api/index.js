/**
 * Vercel serverless entry — CheckGate Express (Legacy TC 라우트 제외)
 */
try {
  module.exports = require('../server');
} catch (err) {
  console.error('[api] server load failed:', err);
  const express = require('express');
  const fail = express();
  fail.all('*', (_req, res) => {
    res.status(500).json({
      ok: false,
      error: 'Server failed to start',
      message: err.message,
    });
  });
  module.exports = fail;
}
