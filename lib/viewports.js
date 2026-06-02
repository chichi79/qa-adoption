const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: {
    width: 375,
    height: 812,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};

function normalizeViewports(input) {
  const raw = Array.isArray(input) ? input : input ? [input] : ['desktop'];
  const valid = raw.filter((v) => VIEWPORTS[v]);
  return valid.length ? [...new Set(valid)] : ['desktop'];
}

module.exports = { VIEWPORTS, normalizeViewports };
