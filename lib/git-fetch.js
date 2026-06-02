const { parseRepoRef } = require('./checklists');

async function fetchPullRequestFiles({ repo, pr, gitRef }) {
  const parsed = parseRepoRef(repo);
  if (!parsed) {
    return {
      ok: false,
      mock: true,
      error: 'Git repo 형식을 인식하지 못했습니다. (예: org/repo 또는 GitHub URL)',
      files: [],
      diffSummary: null,
    };
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const prNumber = pr ? String(pr).replace(/^#/, '').trim() : null;
  const ref = (gitRef || '').trim();

  if (!token) {
    return {
      ok: true,
      mock: true,
      message:
        'GITHUB_TOKEN이 없어 Git diff는 mock 모드입니다. 환경 변수 GITHUB_TOKEN을 설정하면 PR 파일을 가져옵니다.',
      owner: parsed.owner,
      repo: parsed.repo,
      pr: prNumber,
      ref: ref || null,
      files: [],
      diffSummary: { changedFiles: 0, additions: 0, deletions: 0 },
    };
  }

  try {
    if (prNumber) {
      const prRes = await githubGet(
        token,
        `/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}`,
      );
      const filesRes = await githubGet(
        token,
        `/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/files?per_page=100`,
      );
      const files = (filesRes || []).map((f) => ({
        path: f.filename,
        status: f.status,
        patch: f.patch || '',
        additions: f.additions,
        deletions: f.deletions,
      }));
      return {
        ok: true,
        mock: false,
        owner: parsed.owner,
        repo: parsed.repo,
        pr: prNumber,
        title: prRes.title,
        files,
        diffSummary: {
          changedFiles: files.length,
          additions: files.reduce((s, f) => s + (f.additions || 0), 0),
          deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
        },
      };
    }

    if (ref) {
      const compareRes = await githubGet(
        token,
        `/repos/${parsed.owner}/${parsed.repo}/compare/main...${encodeURIComponent(ref)}`,
      );
      const files = (compareRes.files || []).map((f) => ({
        path: f.filename,
        status: f.status,
        patch: f.patch || '',
        additions: f.additions,
        deletions: f.deletions,
      }));
      return {
        ok: true,
        mock: false,
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        files,
        diffSummary: {
          changedFiles: files.length,
          additions: compareRes.stats?.additions || 0,
          deletions: compareRes.stats?.deletions || 0,
        },
      };
    }

    return {
      ok: false,
      mock: true,
      error: 'PR 번호 또는 브랜치/커밋 ref 중 하나를 입력해 주세요.',
      files: [],
    };
  } catch (err) {
    return {
      ok: false,
      mock: false,
      error: err.message || 'GitHub API 호출 실패',
      files: [],
    };
  }
}

async function githubGet(token, apiPath) {
  const url = `https://api.github.com${apiPath}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'qa-checklist-runner',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { fetchPullRequestFiles };
