/**
 * URL 1차 점검 — 내장 항목 (체크리스트 없음)
 */
const path = require('path');
const fs = require('fs');
const { VIEWPORTS, normalizeViewports } = require('./viewports');
const { isVercel } = require('./paths');
const { connectBrowser } = require('./browser');
const MAX_LINKS_TO_CHECK = 15;

/** playwright-core(Vercel)에는 page.waitForTimeout 없음 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageEvidenceReady(evidence) {
  return !!(evidence.finalUrl || evidence.status != null || (evidence.title || '').length > 0);
}

const BUILTIN_CHECKS = [
  {
    id: 'page_load',
    title: '페이지 로드',
    category: 'runtime',
    severity: 'blocker',
    description: 'HTTP 2xx/3xx로 정상 응답',
  },
  {
    id: 'no_console_error',
    title: 'JS 콘솔 에러',
    category: 'runtime',
    severity: 'blocker',
    description: 'console.error 및 uncaught 예외 없음',
  },
  {
    id: 'console_warnings',
    title: '콘솔 경고',
    category: 'runtime',
    severity: 'minor',
    description: 'console.warn 발생 건수 (참고)',
  },
  {
    id: 'failed_network',
    title: '네트워크 요청 실패',
    category: 'runtime',
    severity: 'major',
    description: '4xx/5xx 또는 requestfailed 리소스',
  },
  {
    id: 'page_title',
    title: '페이지 title',
    category: 'runtime',
    severity: 'major',
    description: 'document.title 존재',
  },
  {
    id: 'broken_links',
    title: '링크 오류',
    category: 'links',
    severity: 'major',
    description: '같은 origin 링크 샘플 HTTP 상태 확인',
  },
  {
    id: 'images_alt',
    title: '이미지 alt',
    category: 'accessibility',
    severity: 'minor',
    description: 'img 태그 alt 누락 없음',
  },
  {
    id: 'broken_images',
    title: '깨진 이미지',
    category: 'runtime',
    severity: 'major',
    description: '로드 실패한 img (naturalWidth 0)',
  },
  {
    id: 'h1_present',
    title: 'h1 존재',
    category: 'seo',
    severity: 'major',
    description: '페이지에 h1 요소 1개 이상',
  },
  {
    id: 'meta_viewport',
    title: 'viewport meta',
    category: 'seo',
    severity: 'major',
    description: '모바일 대응 viewport meta 태그',
  },
  {
    id: 'html_lang',
    title: 'html lang',
    category: 'accessibility',
    severity: 'minor',
    description: 'html 요소 lang 속성',
  },
  {
    id: 'meta_description',
    title: 'meta description',
    category: 'seo',
    severity: 'minor',
    description: '검색·공유용 description meta',
  },
  {
    id: 'duplicate_ids',
    title: '중복 id',
    category: 'html',
    severity: 'major',
    description: 'DOM 내 id 중복 없음',
  },
  {
    id: 'mixed_content',
    title: '혼합 콘텐츠',
    category: 'security',
    severity: 'major',
    description: 'HTTPS 페이지에서 HTTP 리소스 참조 없음',
  },
  {
    id: 'empty_links',
    title: '빈/placeholder 링크',
    category: 'links',
    severity: 'minor',
    description: 'href="#" 또는 빈 href 링크 없음',
  },
  {
    id: 'form_labels',
    title: '폼 label/aria',
    category: 'accessibility',
    severity: 'major',
    description: '입력 필드에 label 또는 aria-label',
  },
  {
    id: 'load_time',
    title: '로드 시간',
    category: 'performance',
    severity: 'minor',
    description: '페이지 load 이벤트까지 5초 이내',
  },
  // --- 확장(자동) ---
  {
    id: 'h1_single',
    title: 'h1 단일',
    category: 'seo',
    severity: 'minor',
    description: 'h1은 1개가 권장',
  },
  {
    id: 'canonical_link',
    title: 'canonical link',
    category: 'seo',
    severity: 'minor',
    description: 'link[rel=canonical] 존재',
  },
  {
    id: 'robots_meta',
    title: 'robots meta',
    category: 'seo',
    severity: 'minor',
    description: 'meta[name=robots] 또는 googlebot 존재',
  },
  {
    id: 'og_title',
    title: 'Open Graph title',
    category: 'seo',
    severity: 'minor',
    description: 'meta[property=og:title] 존재',
  },
  {
    id: 'og_image',
    title: 'Open Graph image',
    category: 'seo',
    severity: 'minor',
    description: 'meta[property=og:image] 존재',
  },
  {
    id: 'favicon',
    title: 'favicon',
    category: 'seo',
    severity: 'minor',
    description: '파비콘 링크 존재',
  },
  {
    id: 'heading_order',
    title: '헤딩 구조',
    category: 'accessibility',
    severity: 'minor',
    description: '헤딩 레벨이 과도하게 건너뛰지 않음',
  },
  {
    id: 'aria_references',
    title: 'ARIA 참조 유효성',
    category: 'accessibility',
    severity: 'major',
    description: 'aria-labelledby/aria-describedby 참조 대상이 존재',
  },
  {
    id: 'target_blank_rel',
    title: 'target=_blank rel',
    category: 'security',
    severity: 'major',
    description: 'target=_blank 링크에 rel=noopener 권장',
  },
  {
    id: 'script_sri',
    title: '외부 스크립트 SRI',
    category: 'security',
    severity: 'minor',
    description: '외부 script에 integrity(SRI) 권장',
  },
  {
    id: 'https_form_action',
    title: 'HTTPS 폼 action',
    category: 'security',
    severity: 'major',
    description: 'HTTPS 페이지에서 form action이 http://가 아님',
  },
  {
    id: 'hsts_header',
    title: 'HSTS 헤더',
    category: 'security',
    severity: 'minor',
    description: 'Strict-Transport-Security 헤더',
  },
  {
    id: 'x_content_type_options',
    title: 'X-Content-Type-Options',
    category: 'security',
    severity: 'minor',
    description: 'X-Content-Type-Options: nosniff 권장',
  },
  {
    id: 'x_frame_options',
    title: 'X-Frame-Options',
    category: 'security',
    severity: 'minor',
    description: 'X-Frame-Options 또는 CSP frame-ancestors 권장',
  },
  // --- 성능 수치 ---
  {
    id: 'perf_ttfb',
    title: 'TTFB',
    category: 'performance',
    severity: 'minor',
    description: 'Navigation Timing responseStart 1.8초 이내',
  },
  {
    id: 'perf_dom_content_loaded',
    title: 'DOMContentLoaded',
    category: 'performance',
    severity: 'minor',
    description: 'DOMContentLoaded 3초 이내',
  },
  {
    id: 'perf_resource_count',
    title: '리소스 요청 수',
    category: 'performance',
    severity: 'minor',
    description: 'Performance API 리소스 120개 이하',
  },
  {
    id: 'perf_transfer_size',
    title: '전송 용량',
    category: 'performance',
    severity: 'minor',
    description: '리소스 transferSize 합계 8MB 이하',
  },
  {
    id: 'perf_large_resources',
    title: '대용량 리소스',
    category: 'performance',
    severity: 'minor',
    description: '단일 리소스 512KB 초과 없음',
  },
  // --- 헤더/쿠키 ---
  {
    id: 'csp_header',
    title: 'CSP 헤더',
    category: 'security',
    severity: 'minor',
    description: 'Content-Security-Policy 존재',
  },
  {
    id: 'referrer_policy_header',
    title: 'Referrer-Policy',
    category: 'security',
    severity: 'minor',
    description: 'Referrer-Policy 헤더 존재',
  },
  {
    id: 'permissions_policy_header',
    title: 'Permissions-Policy',
    category: 'security',
    severity: 'minor',
    description: 'Permissions-Policy(또는 Feature-Policy) 존재',
  },
  {
    id: 'cookie_secure',
    title: '쿠키 Secure',
    category: 'security',
    severity: 'major',
    description: 'HTTPS에서 Set-Cookie Secure 플래그',
  },
  {
    id: 'cookie_httponly',
    title: '쿠키 HttpOnly',
    category: 'security',
    severity: 'major',
    description: 'Set-Cookie HttpOnly 플래그',
  },
  // --- 리소스 실로드 ---
  {
    id: 'og_image_load',
    title: 'OG 이미지 로드',
    category: 'seo',
    severity: 'minor',
    description: 'og:image URL HTTP 2xx',
  },
  {
    id: 'favicon_load',
    title: 'favicon 로드',
    category: 'seo',
    severity: 'minor',
    description: 'favicon URL HTTP 2xx',
  },
  {
    id: 'canonical_url_load',
    title: 'canonical 로드',
    category: 'seo',
    severity: 'minor',
    description: 'canonical URL HTTP 2xx',
  },
  // --- robots / sitemap / redirect ---
  {
    id: 'robots_txt',
    title: 'robots.txt',
    category: 'seo',
    severity: 'minor',
    description: 'origin/robots.txt 2xx',
  },
  {
    id: 'sitemap_xml',
    title: 'sitemap',
    category: 'seo',
    severity: 'minor',
    description: 'sitemap.xml(또는 robots Sitemap) 2xx',
  },
  {
    id: 'redirect_chain',
    title: '리다이렉트 체인',
    category: 'runtime',
    severity: 'minor',
    description: '리다이렉트 5회 이하',
  },
  // --- 접근성 심화 ---
  {
    id: 'focusable_accessible_name',
    title: '포커스 요소 이름',
    category: 'accessibility',
    severity: 'major',
    description: '포커스 가능 요소에 접근 가능한 이름',
  },
  {
    id: 'color_contrast_aa',
    title: '색 대비 (AA)',
    category: 'accessibility',
    severity: 'major',
    description: '본문 텍스트 WCAG AA 4.5:1 (샘플)',
  },
  {
    id: 'positive_tabindex',
    title: '양수 tabindex',
    category: 'accessibility',
    severity: 'minor',
    description: 'tabindex > 0 없음',
  },
  {
    id: 'skip_navigation_link',
    title: '스킵 네비게이션',
    category: 'accessibility',
    severity: 'minor',
    description: '본문 바로가기 링크 권장',
  },
];

function evaluateCheck(checkId, evidence) {
  const base = {
    itemId: checkId,
    title: BUILTIN_CHECKS.find((c) => c.id === checkId)?.title || checkId,
    category: BUILTIN_CHECKS.find((c) => c.id === checkId)?.category || 'runtime',
    severity: BUILTIN_CHECKS.find((c) => c.id === checkId)?.severity || 'major',
    inspectType: 'auto',
  };

  switch (checkId) {
    case 'page_load':
      return {
        ...base,
        status: evidence.httpOk ? 'pass' : 'fail',
        evidence: evidence.httpOk
          ? `HTTP ${evidence.status} 로드 성공`
          : `HTTP ${evidence.status ?? 'unknown'} — 페이지 로드 실패`,
      };

    case 'no_console_error': {
      const errs = evidence.consoleErrors || [];
      return {
        ...base,
        status: errs.length === 0 ? 'pass' : 'fail',
        evidence:
          errs.length === 0
            ? '콘솔 에러 없음'
            : `${errs.length}건: ${errs.slice(0, 5).join(' | ')}`,
        suggestion: errs.length ? '브라우저 DevTools 콘솔 에러를 확인하세요.' : undefined,
      };
    }

    case 'console_warnings': {
      const warns = evidence.consoleWarnings || [];
      return {
        ...base,
        status: warns.length === 0 ? 'pass' : 'fail',
        evidence:
          warns.length === 0
            ? '콘솔 warn 없음'
            : `warn ${warns.length}건: ${warns.slice(0, 3).join(' | ')}`,
      };
    }

    case 'failed_network': {
      const failed = evidence.failedRequests || [];
      return {
        ...base,
        status: failed.length === 0 ? 'pass' : 'fail',
        evidence:
          failed.length === 0
            ? '실패한 네트워크 요청 없음'
            : `${failed.length}건: ${failed
                .slice(0, 5)
                .map((f) => `${f.status || 'fail'} ${truncate(f.url, 60)}`)
                .join('; ')}`,
        suggestion: failed.length ? 'Network 탭에서 실패한 API·리소스를 확인하세요.' : undefined,
      };
    }

    case 'page_title': {
      const title = (evidence.title || '').trim();
      return {
        ...base,
        status: title.length > 0 ? 'pass' : 'fail',
        evidence: title ? `"${truncate(title, 80)}"` : 'title이 비어 있음',
      };
    }

    case 'broken_links': {
      const broken = evidence.brokenLinks || [];
      const checked = evidence.linksChecked || 0;
      if (checked === 0) {
        return {
          ...base,
          status: 'skip',
          evidence: '점검할 같은 origin 링크가 없습니다.',
        };
      }
      return {
        ...base,
        status: broken.length === 0 ? 'pass' : 'fail',
        evidence:
          broken.length === 0
            ? `${checked}개 링크 샘플 모두 정상`
            : `${broken.length}/${checked}개 문제: ${broken
                .slice(0, 5)
                .map((b) => `${b.status || 'ERR'} ${truncate(b.url, 50)}`)
                .join('; ')}`,
        suggestion: broken.length ? '깨진 href·404 링크를 수정하세요.' : undefined,
      };
    }

    case 'images_alt': {
      const missing = evidence.imagesMissingAlt || 0;
      const total = evidence.imagesTotal || 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: 'img 태그 없음' };
      }
      return {
        ...base,
        status: missing === 0 ? 'pass' : 'fail',
        evidence:
          missing === 0
            ? `이미지 ${total}개 모두 alt 있음`
            : `${total}개 중 alt 누락 ${missing}개`,
      };
    }

    case 'broken_images': {
      const broken = evidence.brokenImages || [];
      if ((evidence.imagesTotal || 0) === 0) {
        return { ...base, status: 'pass', evidence: 'img 태그 없음' };
      }
      return {
        ...base,
        status: broken.length === 0 ? 'pass' : 'fail',
        evidence:
          broken.length === 0
            ? `이미지 ${evidence.imagesTotal}개 로드 정상`
            : `${broken.length}개 로드 실패: ${broken.slice(0, 3).map((u) => truncate(u, 50)).join('; ')}`,
      };
    }

    case 'h1_present': {
      const count = evidence.h1Count ?? 0;
      return {
        ...base,
        status: count >= 1 ? 'pass' : 'fail',
        evidence: count >= 1 ? `h1 ${count}개` : 'h1 없음',
      };
    }

    case 'meta_viewport':
      return {
        ...base,
        status: evidence.hasViewportMeta ? 'pass' : 'fail',
        evidence: evidence.hasViewportMeta ? 'viewport meta 있음' : 'viewport meta 없음',
      };

    case 'html_lang': {
      const lang = (evidence.htmlLang || '').trim();
      return {
        ...base,
        status: lang.length > 0 ? 'pass' : 'fail',
        evidence: lang ? `lang="${lang}"` : 'html lang 없음',
      };
    }

    case 'meta_description': {
      const desc = (evidence.metaDescription || '').trim();
      return {
        ...base,
        status: desc.length > 0 ? 'pass' : 'fail',
        evidence: desc ? `"${truncate(desc, 80)}"` : 'meta description 없음',
      };
    }

    case 'duplicate_ids': {
      const dupes = evidence.duplicateIds || [];
      return {
        ...base,
        status: dupes.length === 0 ? 'pass' : 'fail',
        evidence:
          dupes.length === 0
            ? '중복 id 없음'
            : `중복 id: ${dupes.slice(0, 5).join(', ')}`,
      };
    }

    case 'mixed_content': {
      if (!evidence.isHttps) {
        return { ...base, status: 'skip', evidence: 'HTTP 페이지 — 혼합 콘텐츠 검사 생략' };
      }
      const mixed = evidence.mixedContentUrls || [];
      return {
        ...base,
        status: mixed.length === 0 ? 'pass' : 'fail',
        evidence:
          mixed.length === 0
            ? 'HTTP 리소스 참조 없음'
            : `${mixed.length}건: ${mixed.slice(0, 3).map((u) => truncate(u, 50)).join('; ')}`,
      };
    }

    case 'empty_links': {
      const n = evidence.emptyLinkCount ?? 0;
      return {
        ...base,
        status: n === 0 ? 'pass' : 'fail',
        evidence: n === 0 ? '빈/placeholder 링크 없음' : `href="#" 또는 빈 링크 ${n}개`,
      };
    }

    case 'form_labels': {
      const unlabeled = evidence.unlabeledInputs ?? 0;
      const total = evidence.formInputsTotal ?? 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: '입력 필드 없음' };
      }
      return {
        ...base,
        status: unlabeled === 0 ? 'pass' : 'fail',
        evidence:
          unlabeled === 0
            ? `입력 ${total}개 모두 label/aria 있음`
            : `${total}개 중 label/aria 없음 ${unlabeled}개`,
      };
    }

    case 'load_time': {
      const ms = evidence.loadDurationMs ?? 0;
      const limit = 5000;
      return {
        ...base,
        status: ms <= limit ? 'pass' : 'fail',
        evidence: `${(ms / 1000).toFixed(2)}초 (기준 ${limit / 1000}초)`,
      };
    }

    case 'h1_single': {
      const count = evidence.h1Count ?? 0;
      if (count === 0) {
        return { ...base, status: 'skip', evidence: 'h1 없음 (h1 존재 항목 참조)' };
      }
      return {
        ...base,
        status: count === 1 ? 'pass' : 'fail',
        evidence: count === 1 ? 'h1 1개' : `h1 ${count}개`,
        suggestion: count > 1 ? '대표 헤딩(h1)은 1개로 정리하는 것이 권장됩니다.' : undefined,
      };
    }

    case 'canonical_link': {
      const href = (evidence.canonicalHref || '').trim();
      return {
        ...base,
        status: href ? 'pass' : 'fail',
        evidence: href ? truncate(href, 100) : 'canonical link 없음',
      };
    }

    case 'robots_meta': {
      const v = (evidence.robotsContent || '').trim();
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 120) : 'robots meta 없음',
      };
    }

    case 'og_title': {
      const v = (evidence.ogTitle || '').trim();
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 120) : 'og:title 없음',
      };
    }

    case 'og_image': {
      const v = (evidence.ogImage || '').trim();
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 120) : 'og:image 없음',
      };
    }

    case 'favicon': {
      const href = (evidence.faviconHref || '').trim();
      return {
        ...base,
        status: href ? 'pass' : 'fail',
        evidence: href ? truncate(href, 120) : 'favicon link 없음',
      };
    }

    case 'heading_order': {
      const total = evidence.headingsTotal ?? 0;
      const skips = evidence.headingLevelSkips ?? 0;
      if (total === 0) {
        return { ...base, status: 'skip', evidence: '헤딩(h1~h6) 없음' };
      }
      return {
        ...base,
        status: skips === 0 ? 'pass' : 'fail',
        evidence: skips === 0 ? `헤딩 ${total}개 — 레벨 점프 없음` : `헤딩 ${total}개 — 레벨 점프 ${skips}회`,
        suggestion: skips ? 'h2→h4 같은 과도한 레벨 점프를 줄이세요.' : undefined,
      };
    }

    case 'aria_references': {
      const broken = evidence.ariaBrokenRefCount ?? 0;
      const total = evidence.ariaRefTotal ?? 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: 'aria 참조 없음' };
      }
      return {
        ...base,
        status: broken === 0 ? 'pass' : 'fail',
        evidence:
          broken === 0 ? `aria 참조 ${total}개 모두 유효` : `aria 참조 ${total}개 중 깨짐 ${broken}개`,
        suggestion: broken ? 'aria-labelledby/aria-describedby가 존재하는 id를 가리키는지 확인하세요.' : undefined,
      };
    }

    case 'target_blank_rel': {
      const missing = evidence.targetBlankMissingRelCount ?? 0;
      const total = evidence.targetBlankCount ?? 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: 'target=_blank 링크 없음' };
      }
      const samples = evidence.targetBlankMissingRelHrefs || [];
      return {
        ...base,
        status: missing === 0 ? 'pass' : 'fail',
        evidence:
          missing === 0
            ? `target=_blank ${total}개 — rel 안전 속성 있음`
            : `${total}개 중 rel(noopener) 누락 ${missing}개: ${samples
                .slice(0, 3)
                .map((h) => truncate(h, 50))
                .join('; ')}`,
        suggestion: missing ? 'target=_blank 링크에 rel="noopener noreferrer"를 추가하세요.' : undefined,
      };
    }

    case 'script_sri': {
      const missing = evidence.externalScriptsMissingSriCount ?? 0;
      const total = evidence.externalScriptsCount ?? 0;
      if (total === 0) {
        return { ...base, status: 'skip', evidence: '외부 script 없음' };
      }
      const samples = evidence.externalScriptsMissingSriSrcs || [];
      return {
        ...base,
        status: missing === 0 ? 'pass' : 'fail',
        evidence:
          missing === 0
            ? `외부 script ${total}개 — integrity 있음`
            : `${total}개 중 integrity 누락 ${missing}개: ${samples
                .slice(0, 2)
                .map((s) => truncate(s, 60))
                .join('; ')}`,
        suggestion: missing ? 'CDN script에는 integrity(SRI) + crossorigin 설정을 고려하세요.' : undefined,
      };
    }

    case 'https_form_action': {
      if (!evidence.isHttps) {
        return { ...base, status: 'skip', evidence: 'HTTP 페이지 — 검사 생략' };
      }
      const insecure = evidence.insecureFormActionsCount ?? 0;
      const total = evidence.formsTotal ?? 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: 'form 없음' };
      }
      const samples = evidence.insecureFormActions || [];
      return {
        ...base,
        status: insecure === 0 ? 'pass' : 'fail',
        evidence:
          insecure === 0
            ? `form ${total}개 — action 안전`
            : `${total}개 중 http action ${insecure}개: ${samples
                .slice(0, 2)
                .map((s) => truncate(s, 80))
                .join('; ')}`,
        suggestion: insecure ? 'HTTPS 페이지에서는 form action도 HTTPS로 맞추세요.' : undefined,
      };
    }

    case 'hsts_header': {
      if (!evidence.isHttps) {
        return { ...base, status: 'skip', evidence: 'HTTP 페이지 — HSTS는 HTTPS에서만 의미' };
      }
      const hsts = headerValue(evidence.mainHeaders, 'strict-transport-security');
      return {
        ...base,
        status: hsts ? 'pass' : 'fail',
        evidence: hsts ? truncate(hsts, 160) : 'Strict-Transport-Security 없음',
      };
    }

    case 'x_content_type_options': {
      const v = headerValue(evidence.mainHeaders, 'x-content-type-options');
      const ok = (v || '').toLowerCase().includes('nosniff');
      return {
        ...base,
        status: ok ? 'pass' : 'fail',
        evidence: v ? truncate(v, 80) : 'X-Content-Type-Options 없음',
        suggestion: ok ? undefined : '응답 헤더에 X-Content-Type-Options: nosniff를 추가하세요.',
      };
    }

    case 'x_frame_options': {
      const xfo = headerValue(evidence.mainHeaders, 'x-frame-options');
      const csp = headerValue(evidence.mainHeaders, 'content-security-policy');
      const hasFrameAncestors = /frame-ancestors/i.test(csp || '');
      const ok = !!xfo || hasFrameAncestors;
      return {
        ...base,
        status: ok ? 'pass' : 'fail',
        evidence: ok
          ? xfo
            ? `X-Frame-Options: ${truncate(xfo, 80)}`
            : `CSP frame-ancestors: ${truncate(csp, 120)}`
          : 'X-Frame-Options/CSP frame-ancestors 없음',
        suggestion: ok ? undefined : '클릭재킹 방지를 위해 X-Frame-Options 또는 CSP frame-ancestors를 설정하세요.',
      };
    }

    case 'perf_ttfb': {
      const ms = evidence.perfTtfbMs;
      if (ms == null) {
        return { ...base, status: 'skip', evidence: 'Navigation Timing 없음' };
      }
      const limit = 1800;
      return {
        ...base,
        status: ms <= limit ? 'pass' : 'fail',
        evidence: `TTFB ${Math.round(ms)}ms (기준 ${limit}ms)`,
      };
    }

    case 'perf_dom_content_loaded': {
      const ms = evidence.perfDclMs;
      if (ms == null) {
        return { ...base, status: 'skip', evidence: 'Navigation Timing 없음' };
      }
      const limit = 3000;
      return {
        ...base,
        status: ms <= limit ? 'pass' : 'fail',
        evidence: `DOMContentLoaded ${Math.round(ms)}ms (기준 ${limit}ms)`,
      };
    }

    case 'perf_resource_count': {
      const count = evidence.perfResourceCount ?? 0;
      const limit = 120;
      return {
        ...base,
        status: count <= limit ? 'pass' : 'fail',
        evidence: `리소스 ${count}개 (기준 ${limit}개 이하)`,
      };
    }

    case 'perf_transfer_size': {
      const bytes = evidence.perfTransferSize ?? 0;
      const limit = 8 * 1024 * 1024;
      if (bytes === 0 && evidence.perfTransferSizeUnknown) {
        return {
          ...base,
          status: 'skip',
          evidence: 'transferSize 측정 불가(교차 origin 제한)',
        };
      }
      return {
        ...base,
        status: bytes <= limit ? 'pass' : 'fail',
        evidence: `${formatBytes(bytes)} (기준 ${formatBytes(limit)} 이하)`,
      };
    }

    case 'perf_large_resources': {
      const large = evidence.perfLargeResources || [];
      return {
        ...base,
        status: large.length === 0 ? 'pass' : 'fail',
        evidence:
          large.length === 0
            ? '512KB 초과 리소스 없음'
            : `${large.length}개: ${large
                .slice(0, 3)
                .map((r) => `${formatBytes(r.size)} ${truncate(r.url, 40)}`)
                .join('; ')}`,
      };
    }

    case 'csp_header': {
      const v = headerValue(evidence.mainHeaders, 'content-security-policy');
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 160) : 'Content-Security-Policy 없음',
      };
    }

    case 'referrer_policy_header': {
      const v =
        headerValue(evidence.mainHeaders, 'referrer-policy') ||
        evidence.referrerPolicyMeta ||
        '';
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 120) : 'Referrer-Policy 없음',
      };
    }

    case 'permissions_policy_header': {
      const v =
        headerValue(evidence.mainHeaders, 'permissions-policy') ||
        headerValue(evidence.mainHeaders, 'feature-policy') ||
        '';
      return {
        ...base,
        status: v ? 'pass' : 'fail',
        evidence: v ? truncate(v, 160) : 'Permissions-Policy 없음',
      };
    }

    case 'cookie_secure': {
      if (!evidence.isHttps) {
        return { ...base, status: 'skip', evidence: 'HTTP 페이지 — Secure 쿠키 검사 생략' };
      }
      const cookies = evidence.setCookies || [];
      if (cookies.length === 0) {
        return { ...base, status: 'pass', evidence: 'Set-Cookie 없음' };
      }
      const missing = cookies.filter((c) => !c.secure);
      return {
        ...base,
        status: missing.length === 0 ? 'pass' : 'fail',
        evidence:
          missing.length === 0
            ? `Set-Cookie ${cookies.length}개 — Secure 있음`
            : `${cookies.length}개 중 Secure 없음 ${missing.length}개`,
        suggestion: missing.length ? 'HTTPS에서는 Set-Cookie에 Secure 플래그를 추가하세요.' : undefined,
      };
    }

    case 'cookie_httponly': {
      const cookies = evidence.setCookies || [];
      if (cookies.length === 0) {
        return { ...base, status: 'pass', evidence: 'Set-Cookie 없음' };
      }
      const missing = cookies.filter((c) => !c.httpOnly);
      return {
        ...base,
        status: missing.length === 0 ? 'pass' : 'fail',
        evidence:
          missing.length === 0
            ? `Set-Cookie ${cookies.length}개 — HttpOnly 있음`
            : `${cookies.length}개 중 HttpOnly 없음 ${missing.length}개`,
        suggestion: missing.length ? '세션 쿠키에는 HttpOnly를 설정하세요.' : undefined,
      };
    }

    case 'og_image_load': {
      const probe = evidence.ogImageProbe;
      if (!evidence.ogImage) {
        return { ...base, status: 'skip', evidence: 'og:image 없음' };
      }
      if (!probe) {
        return { ...base, status: 'skip', evidence: '로드 확인 생략' };
      }
      return {
        ...base,
        status: probe.ok ? 'pass' : 'fail',
        evidence: probe.ok
          ? `HTTP ${probe.status} — ${truncate(probe.url, 80)}`
          : `로드 실패 (${probe.status ?? 'ERR'}) — ${truncate(probe.url, 80)}`,
      };
    }

    case 'favicon_load': {
      const probe = evidence.faviconProbe;
      if (!evidence.faviconHref) {
        return { ...base, status: 'skip', evidence: 'favicon link 없음' };
      }
      if (!probe) {
        return { ...base, status: 'skip', evidence: '로드 확인 생략' };
      }
      return {
        ...base,
        status: probe.ok ? 'pass' : 'fail',
        evidence: probe.ok
          ? `HTTP ${probe.status} — ${truncate(probe.url, 80)}`
          : `로드 실패 (${probe.status ?? 'ERR'}) — ${truncate(probe.url, 80)}`,
      };
    }

    case 'canonical_url_load': {
      const probe = evidence.canonicalProbe;
      if (!evidence.canonicalHref) {
        return { ...base, status: 'skip', evidence: 'canonical link 없음' };
      }
      if (!probe) {
        return { ...base, status: 'skip', evidence: '로드 확인 생략' };
      }
      return {
        ...base,
        status: probe.ok ? 'pass' : 'fail',
        evidence: probe.ok
          ? `HTTP ${probe.status} — ${truncate(probe.url, 80)}`
          : `로드 실패 (${probe.status ?? 'ERR'}) — ${truncate(probe.url, 80)}`,
      };
    }

    case 'robots_txt': {
      const probe = evidence.robotsTxtProbe;
      if (!probe) {
        return { ...base, status: 'skip', evidence: '확인 생략' };
      }
      return {
        ...base,
        status: probe.ok ? 'pass' : 'fail',
        evidence: probe.ok
          ? `HTTP ${probe.status} — ${truncate(probe.url, 80)}`
          : `접근 실패 (${probe.status ?? 'ERR'}) — ${truncate(probe.url, 80)}`,
      };
    }

    case 'sitemap_xml': {
      const probe = evidence.sitemapProbe;
      if (!probe) {
        return { ...base, status: 'skip', evidence: '확인 생략' };
      }
      if (probe.status === 404) {
        return { ...base, status: 'skip', evidence: 'sitemap 없음 (404)' };
      }
      return {
        ...base,
        status: probe.ok ? 'pass' : 'fail',
        evidence: probe.ok
          ? `HTTP ${probe.status} — ${truncate(probe.url, 80)}`
          : `접근 실패 (${probe.status ?? 'ERR'}) — ${truncate(probe.url, 80)}`,
      };
    }

    case 'redirect_chain': {
      const chain = evidence.redirectChain || [];
      const limit = 5;
      if (chain.length <= 1) {
        return { ...base, status: 'pass', evidence: '리다이렉트 없음' };
      }
      const hops = chain.length - 1;
      return {
        ...base,
        status: hops <= limit ? 'pass' : 'fail',
        evidence:
          hops <= limit
            ? `리다이렉트 ${hops}회 → ${truncate(chain[chain.length - 1], 80)}`
            : `리다이렉트 ${hops}회 (기준 ${limit}회 이하): ${chain.map((u) => truncate(u, 40)).join(' → ')}`,
      };
    }

    case 'focusable_accessible_name': {
      const missing = evidence.focusableMissingNameCount ?? 0;
      const total = evidence.focusableTotal ?? 0;
      if (total === 0) {
        return { ...base, status: 'pass', evidence: '포커스 가능 요소 없음' };
      }
      const samples = evidence.focusableMissingNameSamples || [];
      return {
        ...base,
        status: missing === 0 ? 'pass' : 'fail',
        evidence:
          missing === 0
            ? `포커스 요소 ${total}개 — 접근 이름 있음`
            : `${total}개 중 이름 없음 ${missing}개: ${samples.slice(0, 3).join(', ')}`,
        suggestion: missing ? 'button/a/input 등에 텍스트·aria-label·aria-labelledby를 추가하세요.' : undefined,
      };
    }

    case 'color_contrast_aa': {
      const low = evidence.lowContrastCount ?? 0;
      const checked = evidence.contrastCheckedCount ?? 0;
      if (checked === 0) {
        return { ...base, status: 'skip', evidence: '검사할 텍스트 샘플 없음' };
      }
      const samples = evidence.lowContrastSamples || [];
      return {
        ...base,
        status: low === 0 ? 'pass' : 'fail',
        evidence:
          low === 0
            ? `텍스트 ${checked}개 샘플 — AA(4.5:1) 충족`
            : `${checked}개 중 대비 부족 ${low}개: ${samples.slice(0, 3).join('; ')}`,
        suggestion: low ? '텍스트/배경 색 대비를 WCAG AA(4.5:1) 이상으로 조정하세요.' : undefined,
      };
    }

    case 'positive_tabindex': {
      const n = evidence.positiveTabindexCount ?? 0;
      const samples = evidence.positiveTabindexSamples || [];
      return {
        ...base,
        status: n === 0 ? 'pass' : 'fail',
        evidence:
          n === 0 ? 'tabindex > 0 없음' : `tabindex > 0 — ${n}개: ${samples.slice(0, 3).join(', ')}`,
        suggestion: n ? 'tabindex > 0 대신 DOM 순서/시맨틱 구조로 포커스 순서를 맞추세요.' : undefined,
      };
    }

    case 'skip_navigation_link': {
      const has = evidence.hasSkipLink;
      return {
        ...base,
        status: has ? 'pass' : 'fail',
        evidence: has ? '본문 바로가기 링크 있음' : '스킵 네비게이션 링크 없음',
        suggestion: has ? undefined : '키보드 사용자를 위해 #main 등 본문 바로가기 링크를 추가하세요.',
      };
    }

    default:
      return { ...base, status: 'skip', evidence: '알 수 없는 항목' };
  }
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function headerValue(headers, key) {
  if (!headers) return '';
  const k = String(key || '').toLowerCase();
  for (const [hk, hv] of Object.entries(headers)) {
    if (String(hk).toLowerCase() === k) return String(hv || '');
  }
  return '';
}

function getRedirectChain(response) {
  if (!response) return [];
  const chain = [];
  let req = response.request();
  while (req) {
    chain.unshift(req.url());
    req = req.redirectedFrom();
  }
  return chain;
}

function parseSetCookieHeaders(response) {
  if (!response) return [];

  let headersArray = [];
  try {
    if (typeof response.headersArray === 'function') {
      const raw = response.headersArray();
      headersArray = Array.isArray(raw) ? raw : [];
    } else if (Array.isArray(response.headersArray)) {
      headersArray = response.headersArray;
    }

    if (headersArray.length === 0) {
      const headers = response.headers?.() || {};
      for (const [name, value] of Object.entries(headers)) {
        if (String(name).toLowerCase() === 'set-cookie' && value) {
          headersArray.push({ name: 'set-cookie', value: String(value) });
        }
      }
    }
  } catch (_) {
    headersArray = [];
  }

  if (!Array.isArray(headersArray)) headersArray = [];

  return headersArray
    .filter((h) => h && String(h.name || '').toLowerCase() === 'set-cookie')
    .map((h) => {
      const raw = h.value || '';
      const parts = raw.split(';').map((p) => p.trim());
      const namePart = parts[0] || '';
      const flags = parts.slice(1).map((p) => p.toLowerCase());
      const name = namePart.split('=')[0] || namePart;
      return {
        name,
        secure: flags.some((f) => f === 'secure'),
        httpOnly: flags.some((f) => f === 'httponly'),
      };
    });
}

async function probeUrl(request, url, baseUrl) {
  if (!url) return null;
  try {
    const abs = new URL(url, baseUrl).href;
    let res = await request.head(abs, { timeout: 10000, maxRedirects: 5 });
    let status = res.status();
    if (status === 405 || status === 501) {
      res = await request.get(abs, { timeout: 10000, maxRedirects: 5 });
      status = res.status();
    }
    return { ok: status >= 200 && status < 400, status, url: abs };
  } catch (err) {
    return { ok: false, status: null, url: String(url), error: err.message || String(err) };
  }
}

async function checkRobotsAndSitemap(request, origin) {
  const robotsUrl = `${origin}/robots.txt`;
  let robotsTxtProbe = null;
  let sitemapUrl = `${origin}/sitemap.xml`;

  try {
    const res = await request.get(robotsUrl, { timeout: 10000, maxRedirects: 3 });
    const status = res.status();
    robotsTxtProbe = { ok: status >= 200 && status < 400, status, url: robotsUrl };
    if (robotsTxtProbe.ok) {
      const text = await res.text();
      const match = text.match(/^Sitemap:\s*(\S+)/im);
      if (match) sitemapUrl = match[1].trim();
    }
  } catch (err) {
    robotsTxtProbe = { ok: false, status: null, url: robotsUrl, error: err.message || String(err) };
  }

  let sitemapProbe = null;
  try {
    const abs = new URL(sitemapUrl, origin).href;
    const res = await request.get(abs, { timeout: 10000, maxRedirects: 3 });
    const status = res.status();
    sitemapProbe = { ok: status >= 200 && status < 400, status, url: abs };
  } catch (err) {
    sitemapProbe = { ok: false, status: null, url: sitemapUrl, error: err.message || String(err) };
  }

  return { robotsTxtProbe, sitemapProbe };
}

async function enrichEvidenceWithProbes(request, evidence, baseUrl) {
  const [ogImageProbe, faviconProbe, canonicalProbe, siteProbes] = await Promise.all([
    evidence.ogImage ? probeUrl(request, evidence.ogImage, baseUrl) : Promise.resolve(null),
    evidence.faviconHref ? probeUrl(request, evidence.faviconHref, baseUrl) : Promise.resolve(null),
    evidence.canonicalHref ? probeUrl(request, evidence.canonicalHref, baseUrl) : Promise.resolve(null),
    checkRobotsAndSitemap(request, new URL(baseUrl).origin),
  ]);

  evidence.ogImageProbe = ogImageProbe;
  evidence.faviconProbe = faviconProbe;
  evidence.canonicalProbe = canonicalProbe;
  evidence.robotsTxtProbe = siteProbes.robotsTxtProbe;
  evidence.sitemapProbe = siteProbes.sitemapProbe;
}

async function checkLinks(page, pageUrl, maxLinks) {
  const origin = new URL(pageUrl).origin;
  const hrefs = await page.$$eval('a[href]', (anchors) =>
    anchors
      .map((a) => {
        try {
          return new URL(a.href, window.location.href).href;
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean),
  );

  const unique = [...new Set(hrefs.filter((h) => h.startsWith(origin)))].slice(0, maxLinks);
  const broken = [];
  const request = page.context().request;

  for (const link of unique) {
    try {
      const res = await request.get(link, { timeout: 10000, maxRedirects: 5 });
      const status = res.status();
      if (status >= 400) {
        broken.push({ url: link, status });
      }
    } catch (err) {
      broken.push({ url: link, status: null, error: err.message || String(err) });
    }
  }

  return { checked: unique.length, broken };
}

function collectDomStatsInPage() {
  const imgs = Array.from(document.querySelectorAll('img'));
  const missingAlt = imgs.filter((img) => !(img.getAttribute('alt') || '').trim()).length;
  const brokenImages = imgs
    .filter((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:')) return false;
      return img.complete && img.naturalWidth === 0;
    })
    .map((img) => (img.currentSrc || img.src || '').slice(0, 120));

  const h1Count = document.querySelectorAll('h1').length;
  const viewportEl = document.querySelector('meta[name="viewport"]');
  const viewportContent = viewportEl ? viewportEl.getAttribute('content') || '' : '';
  const hasViewportMeta = !!viewportEl;
  const htmlLang = document.documentElement.getAttribute('lang') || '';
  const metaEl = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const metaDescription = metaEl ? metaEl.getAttribute('content') || '' : '';

  const canonicalHref =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || '';
  const robotsContent =
    document.querySelector('meta[name="robots"]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="googlebot"]')?.getAttribute('content')?.trim() ||
    '';
  const ogTitle =
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
  const faviconHref =
    document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      ?.getAttribute('href')
      ?.trim() || '';

  const ids = Array.from(document.querySelectorAll('[id]'))
    .map((el) => el.id)
    .filter(Boolean);
  const seen = new Set();
  const duplicateIds = [];
  for (const id of ids) {
    if (seen.has(id)) duplicateIds.push(id);
    else seen.add(id);
  }

  const isHttps = window.location.protocol === 'https:';
  const mixedContentUrls = [];
  if (isHttps) {
    const urls = [];
    document.querySelectorAll('[src],[href]').forEach((el) => {
      const v = el.getAttribute('src') || el.getAttribute('href') || '';
      if (v.startsWith('http://')) urls.push(v.slice(0, 120));
    });
    mixedContentUrls.push(...urls.slice(0, 20));
  }

  let emptyLinkCount = 0;
  document.querySelectorAll('a[href]').forEach((a) => {
    const h = (a.getAttribute('href') || '').trim();
    if (h === '' || h === '#' || h.startsWith('javascript:void')) emptyLinkCount += 1;
  });

  const targetBlankAnchors = Array.from(document.querySelectorAll('a[target="_blank"]'));
  const targetBlankCount = targetBlankAnchors.length;
  const targetBlankMissingRelHrefs = [];
  targetBlankAnchors.forEach((a) => {
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    if (!rel.includes('noopener')) {
      const href = (a.getAttribute('href') || a.href || '').trim();
      if (href) targetBlankMissingRelHrefs.push(href.slice(0, 200));
    }
  });

  const scripts = Array.from(document.querySelectorAll('script[src]'));
  const externalScripts = scripts.filter((s) => {
    const src = (s.getAttribute('src') || '').trim();
    return /^https?:\/\//i.test(src);
  });
  const externalScriptsCount = externalScripts.length;
  const externalScriptsMissingSriSrcs = [];
  externalScripts.forEach((s) => {
    const integrity = (s.getAttribute('integrity') || '').trim();
    if (!integrity) externalScriptsMissingSriSrcs.push((s.getAttribute('src') || '').slice(0, 200));
  });

  const forms = Array.from(document.querySelectorAll('form'));
  const formsTotal = forms.length;
  const insecureFormActions = [];
  if (isHttps) {
    forms.forEach((f) => {
      const action = (f.getAttribute('action') || '').trim();
      if (action.startsWith('http://')) insecureFormActions.push(action.slice(0, 200));
    });
  }

  const inputs = Array.from(
    document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select',
    ),
  );
  let unlabeledInputs = 0;
  inputs.forEach((el) => {
    const id = el.id;
    const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!hasLabel && !hasAria) unlabeledInputs += 1;
  });

  const ariaRefAttrs = ['aria-labelledby', 'aria-describedby'];
  let ariaRefTotal = 0;
  let ariaBrokenRefCount = 0;
  document.querySelectorAll(`[aria-labelledby],[aria-describedby]`).forEach((el) => {
    ariaRefAttrs.forEach((attr) => {
      const val = (el.getAttribute(attr) || '').trim();
      if (!val) return;
      const ids = val.split(/\s+/).filter(Boolean);
      ariaRefTotal += ids.length;
      ids.forEach((id) => {
        if (!document.getElementById(id)) ariaBrokenRefCount += 1;
      });
    });
  });

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const levels = headings.map((h) => Number(h.tagName.slice(1)));
  let headingLevelSkips = 0;
  for (let i = 1; i < levels.length; i += 1) {
    const prev = levels[i - 1];
    const cur = levels[i];
    if (cur - prev > 1) headingLevelSkips += 1;
  }

  return {
    imagesTotal: imgs.length,
    imagesMissingAlt: missingAlt,
    brokenImages,
    h1Count,
    hasViewportMeta,
    viewportContent,
    htmlLang,
    metaDescription,
    canonicalHref,
    robotsContent,
    ogTitle,
    ogImage,
    faviconHref,
    duplicateIds: [...new Set(duplicateIds)],
    isHttps,
    mixedContentUrls: [...new Set(mixedContentUrls)],
    emptyLinkCount,
    targetBlankCount,
    targetBlankMissingRelCount: targetBlankMissingRelHrefs.length,
    targetBlankMissingRelHrefs: [...new Set(targetBlankMissingRelHrefs)].slice(0, 10),
    externalScriptsCount,
    externalScriptsMissingSriCount: externalScriptsMissingSriSrcs.length,
    externalScriptsMissingSriSrcs: [...new Set(externalScriptsMissingSriSrcs)].slice(0, 10),
    formsTotal,
    insecureFormActionsCount: insecureFormActions.length,
    insecureFormActions: [...new Set(insecureFormActions)].slice(0, 10),
    formInputsTotal: inputs.length,
    unlabeledInputs,
    ariaRefTotal,
    ariaBrokenRefCount,
    headingsTotal: headings.length,
    headingLevelSkips,
  };
}

function collectExtendedStatsInPage() {
  const nav = performance.getEntriesByType('navigation')[0];
  let perfTtfbMs = nav ? nav.responseStart : null;
  let perfDclMs = nav ? nav.domContentLoadedEventEnd : null;

  const resources = performance.getEntriesByType('resource');
  let perfTransferSize = 0;
  let perfTransferSizeUnknown = false;
  const perfLargeResources = [];

  resources.forEach((r) => {
    const size = r.transferSize || 0;
    if (size === 0 && r.decodedBodySize > 0) perfTransferSizeUnknown = true;
    perfTransferSize += size;
    if (size > 512 * 1024) {
      perfLargeResources.push({ url: r.name.slice(0, 200), size });
    }
  });

  const referrerPolicyMeta =
    document.querySelector('meta[name="referrer"]')?.getAttribute('content')?.trim() || '';

  const skipSelectors =
    'a[href^="#main"], a[href^="#content"], a[href^="#skip"], a.skip-link, a.skip, .skip-link a, .skip-to-content';
  const hasSkipLink = !!document.querySelector(skipSelectors);

  function getAccessibleName(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labelledby = (el.getAttribute('aria-labelledby') || '').trim();
    if (labelledby) {
      return labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
    }
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'image') return (el.getAttribute('alt') || '').trim();
      return (el.getAttribute('value') || el.getAttribute('placeholder') || '').trim();
    }
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const focusableSelector =
    'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]';
  const focusables = Array.from(document.querySelectorAll(focusableSelector)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });

  const focusableMissingNameSamples = [];
  focusables.forEach((el) => {
    if (!getAccessibleName(el)) {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : tag;
      focusableMissingNameSamples.push(id);
    }
  });

  const positiveTabindexSamples = [];
  document.querySelectorAll('[tabindex]').forEach((el) => {
    const ti = Number(el.getAttribute('tabindex'));
    if (ti > 0) {
      const id = el.id ? `#${el.id}` : el.tagName.toLowerCase();
      positiveTabindexSamples.push(`${id}(${ti})`);
    }
  });

  function parseRgb(color) {
    if (!color) return null;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  function relativeLuminance(r, g, b) {
    const conv = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
  }

  function contrastRatio(rgb1, rgb2) {
    const l1 = relativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
    const l2 = relativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getBackgroundRgb(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const bg = parseRgb(window.getComputedStyle(cur).backgroundColor);
      if (bg) return bg;
      cur = cur.parentElement;
    }
    return [255, 255, 255];
  }

  const textCandidates = Array.from(
    document.querySelectorAll('p, span, a, li, label, h1, h2, h3, h4, h5, h6, td, th, button'),
  ).filter((el) => {
    const text = (el.textContent || '').trim();
    if (!text || text.length < 2) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  const contrastSample = textCandidates.slice(0, 50);
  const lowContrastSamples = [];
  contrastSample.forEach((el) => {
    const style = window.getComputedStyle(el);
    const fg = parseRgb(style.color);
    const bg = getBackgroundRgb(el);
    if (!fg) return;
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) {
      const snippet = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      lowContrastSamples.push(`"${snippet}" ${ratio.toFixed(1)}:1`);
    }
  });

  return {
    perfTtfbMs,
    perfDclMs,
    perfResourceCount: resources.length,
    perfTransferSize,
    perfTransferSizeUnknown,
    perfLargeResources: perfLargeResources.slice(0, 10),
    referrerPolicyMeta,
    hasSkipLink,
    focusableTotal: focusables.length,
    focusableMissingNameCount: focusableMissingNameSamples.length,
    focusableMissingNameSamples: [...new Set(focusableMissingNameSamples)].slice(0, 10),
    positiveTabindexCount: positiveTabindexSamples.length,
    positiveTabindexSamples: [...new Set(positiveTabindexSamples)].slice(0, 10),
    contrastCheckedCount: contrastSample.length,
    lowContrastCount: lowContrastSamples.length,
    lowContrastSamples: lowContrastSamples.slice(0, 10),
  };
}

async function inspectUrlOnce({ url, resultsDir, viewport = 'desktop', options = {} }) {
  const maxLinks = options.maxLinks ?? MAX_LINKS_TO_CHECK;
  const vp = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];
  const start = Date.now();

  let browser;
  let launched = false;
  let context;
  let page;

  const evidence = {
    url,
    finalUrl: '',
    title: '',
    httpOk: false,
    status: null,
    mainHeaders: {},
    consoleErrors: [],
    consoleWarnings: [],
    failedRequests: [],
    brokenLinks: [],
    linksChecked: 0,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    brokenImages: [],
    h1Count: 0,
    hasViewportMeta: false,
    viewportContent: '',
    htmlLang: '',
    metaDescription: '',
    canonicalHref: '',
    robotsContent: '',
    ogTitle: '',
    ogImage: '',
    faviconHref: '',
    duplicateIds: [],
    isHttps: false,
    mixedContentUrls: [],
    emptyLinkCount: 0,
    targetBlankCount: 0,
    targetBlankMissingRelCount: 0,
    targetBlankMissingRelHrefs: [],
    externalScriptsCount: 0,
    externalScriptsMissingSriCount: 0,
    externalScriptsMissingSriSrcs: [],
    formsTotal: 0,
    insecureFormActionsCount: 0,
    insecureFormActions: [],
    formInputsTotal: 0,
    unlabeledInputs: 0,
    ariaRefTotal: 0,
    ariaBrokenRefCount: 0,
    headingsTotal: 0,
    headingLevelSkips: 0,
    loadDurationMs: 0,
    redirectChain: [],
    setCookies: [],
    perfTtfbMs: null,
    perfDclMs: null,
    perfResourceCount: 0,
    perfTransferSize: 0,
    perfTransferSizeUnknown: false,
    perfLargeResources: [],
    referrerPolicyMeta: '',
    hasSkipLink: false,
    focusableTotal: 0,
    focusableMissingNameCount: 0,
    focusableMissingNameSamples: [],
    positiveTabindexCount: 0,
    positiveTabindexSamples: [],
    contrastCheckedCount: 0,
    lowContrastCount: 0,
    lowContrastSamples: [],
    ogImageProbe: null,
    faviconProbe: null,
    canonicalProbe: null,
    robotsTxtProbe: null,
    sitemapProbe: null,
    screenshot: null,
  };

  try {
    ({ browser, launched } = await connectBrowser());
    context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile || false,
      deviceScaleFactor: vp.deviceScaleFactor || 1,
      userAgent: vp.userAgent,
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      if (msg.type() === 'warning') consoleWarnings.push(text);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message || String(err));
    });
    page.on('response', (response) => {
      const status = response.status();
      const resUrl = response.url();
      if (status >= 400 && !failedRequests.some((f) => f.url === resUrl)) {
        failedRequests.push({ url: resUrl, status });
      }
    });
    page.on('requestfailed', (request) => {
      const reqUrl = request.url();
      if (!failedRequests.some((f) => f.url === reqUrl)) {
        failedRequests.push({
          url: reqUrl,
          status: null,
          error: request.failure()?.errorText || 'failed',
        });
      }
    });

    const navTimeout = isVercel ? 45000 : 30000;
    const response = await page.goto(url, {
      waitUntil: isVercel ? 'domcontentloaded' : 'load',
      timeout: navTimeout,
    });
    evidence.loadDurationMs = Date.now() - start;
    await delay(isVercel ? 800 : 1500);

    evidence.httpOk = response ? response.status() < 400 : false;
    evidence.status = response ? response.status() : null;
    evidence.mainHeaders = response ? response.headers() : {};
    evidence.finalUrl = page.url();
    evidence.title = await page.title();
    evidence.redirectChain = getRedirectChain(response);
    try {
      evidence.setCookies = parseSetCookieHeaders(response);
    } catch (_) {
      evidence.setCookies = [];
    }

    const domStats = await page.evaluate(collectDomStatsInPage);
    Object.assign(evidence, domStats);
    const extendedStats = await page.evaluate(collectExtendedStatsInPage);
    Object.assign(evidence, extendedStats);
    try {
      evidence.isHttps = new URL(page.url()).protocol === 'https:';
    } catch (_) {
      /* keep from domStats */
    }

    try {
      const linkResult = await checkLinks(page, page.url(), maxLinks);
      evidence.linksChecked = linkResult.checked;
      evidence.brokenLinks = linkResult.broken;
    } catch (linkErr) {
      evidence.linksChecked = 0;
      evidence.brokenLinks = [];
      evidence.linkCheckError = linkErr.message || String(linkErr);
    }

    try {
      await enrichEvidenceWithProbes(page.context().request, evidence, page.url());
    } catch (probeErr) {
      evidence.probeError = probeErr.message || String(probeErr);
    }

    evidence.consoleErrors = [...new Set(consoleErrors)];
    evidence.consoleWarnings = [...new Set(consoleWarnings)];
    evidence.failedRequests = failedRequests.slice(0, 30);

    if (resultsDir) {
      try {
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
        const shotName = viewport === 'desktop' ? 'screenshot.png' : `screenshot-${viewport}.png`;
        const shotPath = path.join(resultsDir, shotName);
        await page.screenshot({ path: shotPath, fullPage: false, timeout: 15000 });
        evidence.screenshot = shotPath;
      } catch (_) {
        /* 스크린샷 실패해도 점검 결과는 유지 */
      }
    }

    const results = BUILTIN_CHECKS.map((c) => evaluateCheck(c.id, evidence));

    return {
      ok: true,
      viewport,
      duration: Date.now() - start,
      evidence,
      results,
      checks: BUILTIN_CHECKS,
    };
  } catch (err) {
    const errMsg = err.message || String(err);
    const partial = pageEvidenceReady(evidence);
    const results = BUILTIN_CHECKS.map((c) => {
      const evaluated = evaluateCheck(c.id, evidence);
      if (partial) return evaluated;
      return {
        ...evaluated,
        status: c.id === 'page_load' ? 'fail' : 'skip',
        evidence: c.id === 'page_load' ? errMsg : '페이지 로드 실패로 건너뜀',
      };
    });
    if (results[0] && !partial) {
      results[0].suggestion = isVercel
        ? '브라우저 점검 중 오류입니다. URL·타임아웃·접근 차단 여부를 확인하세요.'
        : 'Edge CDP 디버깅 모드가 실행 중인지 확인하세요.';
    }
    return {
      ok: false,
      viewport,
      duration: Date.now() - start,
      error: err.message || String(err),
      evidence,
      results,
      checks: BUILTIN_CHECKS,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser && launched) await browser.close().catch(() => {});
  }
}

async function inspectUrl({ url, resultsDir, options = {} }) {
  const viewports = normalizeViewports(options.viewports);
  const outs = [];

  for (const viewport of viewports) {
    const dir = resultsDir && viewports.length === 1 ? resultsDir : resultsDir;
    outs.push(await inspectUrlOnce({ url, resultsDir: dir, viewport, options }));
  }

  const results = outs.flatMap((out) =>
    out.results.map((r) => ({
      ...r,
      viewport: out.viewport,
      title:
        viewports.length > 1 && out.viewport === 'mobile' ? `${r.title} (모바일)` : r.title,
    })),
  );

  const primary = outs[0];
  const allPassed = results.every((r) => r.status !== 'fail');
  const duration = outs.reduce((sum, o) => sum + o.duration, 0);
  const fatalError = outs.find((o) => o.error)?.error || null;

  return {
    ok: !fatalError,
    allPassed,
    duration,
    evidence: primary?.evidence || {},
    evidences: Object.fromEntries(outs.map((o) => [o.viewport, o.evidence])),
    results,
    checks: BUILTIN_CHECKS,
    viewports,
    error: fatalError,
  };
}

module.exports = { inspectUrl, inspectUrlOnce, BUILTIN_CHECKS };
