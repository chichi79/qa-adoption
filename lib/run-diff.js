function resultKey(r) {
  return `${r.viewport || 'desktop'}:${r.itemId}`;
}

function diffRuns(previous, current) {
  if (!previous?.results?.length || !current?.results?.length) {
    return {
      hasPrevious: !!previous,
      hasRegression: false,
      newFails: [],
      fixed: [],
      unchanged: [],
      summary: { newFail: 0, fixed: 0, unchanged: 0 },
    };
  }

  const prevMap = new Map(previous.results.map((r) => [resultKey(r), r]));
  const newFails = [];
  const fixed = [];
  const unchanged = [];

  for (const cur of current.results) {
    const prev = prevMap.get(resultKey(cur));
    if (!prev) continue;

    if (prev.status !== 'fail' && cur.status === 'fail') {
      newFails.push({
        itemId: cur.itemId,
        title: cur.title,
        viewport: cur.viewport || 'desktop',
        evidence: cur.evidence,
        previousStatus: prev.status,
      });
    } else if (prev.status === 'fail' && cur.status === 'pass') {
      fixed.push({
        itemId: cur.itemId,
        title: cur.title,
        viewport: cur.viewport || 'desktop',
      });
    } else if (prev.status === cur.status) {
      unchanged.push({ itemId: cur.itemId, status: cur.status, viewport: cur.viewport || 'desktop' });
    }
  }

  return {
    hasPrevious: true,
    previousRunId: previous.id,
    previousAt: previous.completedAt,
    hasRegression: newFails.length > 0,
    newFails,
    fixed,
    unchanged,
    summary: {
      newFail: newFails.length,
      fixed: fixed.length,
      unchanged: unchanged.length,
    },
  };
}

function diffBatchPages(previousPages, currentPages) {
  const prevByUrl = new Map((previousPages || []).map((p) => [p.url, p]));
  const pageDiffs = [];

  for (const page of currentPages || []) {
    const prev = prevByUrl.get(page.url);
    if (!prev) {
      pageDiffs.push({ url: page.url, type: 'new', fail: page.summary?.fail || 0 });
      continue;
    }
    const prevFail = prev.summary?.fail || 0;
    const curFail = page.summary?.fail || 0;
    if (curFail > prevFail) {
      pageDiffs.push({ url: page.url, type: 'regressed', prevFail, curFail });
    } else if (curFail < prevFail) {
      pageDiffs.push({ url: page.url, type: 'improved', prevFail, curFail });
    }
  }

  return {
    hasRegression: pageDiffs.some((p) => p.type === 'regressed' || (p.type === 'new' && p.fail > 0)),
    pages: pageDiffs,
  };
}

module.exports = { diffRuns, diffBatchPages, resultKey };
