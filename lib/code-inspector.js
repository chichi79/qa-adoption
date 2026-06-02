function itemResultFields(item) {
  return {
    itemId: item.itemKey || item.id,
    title: item.title,
    severity: item.severity,
    inspectType: item.inspectType,
    checklistName: item.checklistName,
    checklistKind: item.checklistKind,
  };
}

function inspectCodeItem(item, gitData) {
  const rule = item.config && item.config.rule;
  const files = gitData.files || [];

  if (gitData.mock && files.length === 0) {
    return {
      ...itemResultFields(item),
      status: 'skip',
      evidence: gitData.message || gitData.error || 'Git diff 없음 (mock)',
      suggestion: 'GITHUB_TOKEN 설정 후 PR 번호와 함께 다시 점검하세요.',
    };
  }

  if (!files.length) {
    return {
      ...itemResultFields(item),
      status: 'skip',
      evidence: '변경 파일이 없습니다.',
    };
  }

  if (rule === 'no_console_log') {
    const hits = [];
    for (const f of files) {
      const patch = f.patch || '';
      const addedLines = patch
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
        .join('\n');
      if (/console\.log\s*\(/.test(addedLines)) {
        hits.push(f.path);
      }
    }
    if (hits.length) {
      return {
        ...itemResultFields(item),
        status: 'fail',
        evidence: `console.log 추가: ${hits.join(', ')}`,
        suggestion: '디버그용 console.log를 제거하거나 logger로 대체하세요.',
      };
    }
    return {
      ...itemResultFields(item),
      status: 'pass',
      evidence: `변경 ${files.length}개 파일에서 console.log 추가 없음`,
    };
  }

  if (rule === 'no_explicit_any') {
    const hits = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f.path)) continue;
      const patch = f.patch || '';
      const addedLines = patch
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
        .join('\n');
      if (/:\s*any\b|as\s+any\b/.test(addedLines)) {
        hits.push(f.path);
      }
    }
    if (hits.length) {
      return {
        ...itemResultFields(item),
        status: 'fail',
        evidence: `any 타입 사용: ${hits.join(', ')}`,
        suggestion: '구체적인 타입을 지정하세요.',
      };
    }
    return {
      ...itemResultFields(item),
      status: 'pass',
      evidence: '변경 TS 파일에서 explicit any 없음',
    };
  }

  return {
    ...itemResultFields(item),
    status: 'skip',
    evidence: `지원하지 않는 코드 규칙: ${rule || '(없음)'}`,
  };
}

function inspectAllCodeItems(items, gitData) {
  return items
    .filter((i) => i.inspectType === 'ai_code')
    .map((item) => inspectCodeItem(item, gitData));
}

module.exports = { inspectCodeItem, inspectAllCodeItems };
