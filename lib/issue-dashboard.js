/**
 * 점검 결과 → 공정별 오류 대시보드 (동작 오류 / 코드·성능 / 보안 / 접근성·SEO)
 */
const LANE_ORDER = ['runtime', 'quality', 'security', 'a11y_seo'];

const LANE_META = {
  runtime: {
    id: 'runtime',
    label: '동작 오류',
    hint: '로드·JS 콘솔·네트워크·이미지 등 런타임',
  },
  quality: {
    id: 'quality',
    label: '코드·성능',
    hint: '링크·HTML·로딩·리소스 등 품질·최적화',
  },
  security: {
    id: 'security',
    label: '보안',
    hint: 'HTTPS·헤더·CSP·쿠키 등',
  },
  a11y_seo: {
    id: 'a11y_seo',
    label: '접근성·SEO',
    hint: 'alt·lang·meta·h1 등',
  },
};

const CATEGORY_TO_LANE = {
  runtime: 'runtime',
  performance: 'quality',
  links: 'quality',
  html: 'quality',
  security: 'security',
  accessibility: 'a11y_seo',
  seo: 'a11y_seo',
};

const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 };

function laneForResult(r) {
  return CATEGORY_TO_LANE[r.category] || 'quality';
}

function sortIssues(items) {
  return [...items].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 9;
    const sb = SEVERITY_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.title || '').localeCompare(b.title || '');
  });
}

function buildSingleDashboard(results) {
  const lanes = {};
  LANE_ORDER.forEach((id) => {
    lanes[id] = { ...LANE_META[id], fail: 0, issues: [] };
  });

  const fails = (results || []).filter((r) => r.status === 'fail');
  for (const r of fails) {
    const laneId = laneForResult(r);
    lanes[laneId].fail += 1;
    lanes[laneId].issues.push({
      itemId: r.itemId,
      title: r.title,
      category: r.category,
      severity: r.severity,
      viewport: r.viewport,
      evidence: r.evidence,
      suggestion: r.suggestion,
    });
  }

  LANE_ORDER.forEach((id) => {
    lanes[id].issues = sortIssues(lanes[id].issues);
  });

  return {
    mode: 'single',
    totalFail: fails.length,
    totalPass: (results || []).filter((r) => r.status === 'pass').length,
    lanes: LANE_ORDER.map((id) => lanes[id]),
    topIssues: sortIssues(
      fails.map((r) => ({
        itemId: r.itemId,
        title: r.title,
        category: r.category,
        severity: r.severity,
        viewport: r.viewport,
        lane: laneForResult(r),
        laneLabel: LANE_META[laneForResult(r)].label,
        evidence: r.evidence,
      })),
    ).slice(0, 12),
  };
}

function buildBatchDashboard(run) {
  const pages = run.pages || [];
  const regressed =
    run.diff?.pages?.filter(
      (p) => p.type === 'regressed' || (p.type === 'new' && (p.fail || 0) > 0),
    ) || [];

  return {
    mode: 'batch',
    totalFail: run.summary?.fail || 0,
    failPages: run.summary?.failPages || 0,
    passPages: run.summary?.passPages || 0,
    pageCount: pages.length,
    lanes: null,
    topIssues: pages
      .filter((p) => (p.summary?.fail || 0) > 0)
      .map((p) => ({
        title: p.url,
        category: 'batch',
        severity: 'major',
        viewport: '',
        lane: 'runtime',
        laneLabel: '페이지',
        evidence: `fail ${p.summary?.fail || 0} · pass ${p.summary?.pass || 0}`,
        runId: p.runId,
      }))
      .slice(0, 12),
    regressedPages: regressed.slice(0, 8),
    newFailCount: run.diff?.summary?.newFail,
    hasRegression: !!run.diff?.hasRegression,
  };
}

function buildIssueDashboard(run) {
  if (!run) return { mode: 'empty', totalFail: 0, lanes: [], topIssues: [] };
  if (run.type === 'batch') return buildBatchDashboard(run);
  return buildSingleDashboard(run.results || []);
}

module.exports = {
  LANE_ORDER,
  LANE_META,
  CATEGORY_TO_LANE,
  buildIssueDashboard,
  buildSingleDashboard,
  buildBatchDashboard,
};
