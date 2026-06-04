# CheckGate (1차)

입력한 **URL만**으로 Playwright(CDP Edge) 기본 점검을 수행합니다. **Git·레포·PR 연동 없음.**

## 점검 항목 (내장 51개)

| 구분 | 항목 |
|------|------|
| **런타임** | 페이지 로드, JS 콘솔 에러/경고, 네트워크 실패, title, 깨진 이미지, 리다이렉트 체인 |
| **링크** | 같은 origin 링크 HTTP 상태, 빈/placeholder 링크 |
| **접근성** | img alt, html lang, 폼 label/aria, 헤딩 구조, ARIA 참조, 포커스 요소 이름, 색 대비(AA), tabindex, 스킵 네비 |
| **SEO** | h1, viewport, meta description, canonical(존재·로드), robots meta, OG title/image(존재·로드), favicon(존재·로드), robots.txt, sitemap |
| **HTML** | 중복 id |
| **보안** | 혼합 콘텐츠, target=_blank rel, SRI, HTTPS form action, HSTS, nosniff, XFO/CSP, CSP, Referrer-Policy, Permissions-Policy, 쿠키 Secure/HttpOnly |
| **성능** | load 5초, TTFB, DOMContentLoaded, 리소스 수/용량, 대용량 리소스 |

체크리스트·Git·Admin은 **2차 이후**로 보류했습니다. (`admin.html`, `data/checklists.json` 등은 레포에 남아 있으나 메인 UI에서 사용하지 않습니다.)

## 상위 요구사항과 CheckGate 매핑

| 요구 | 구현 |
|------|------|
| 대시보드처럼 오류를 한곳에서 정리 | **오류 대시보드** — 동작 오류 / 코드·성능 / 보안 / 접근성·SEO 공정별 집계 + 상위 오류 목록 |
| 표준 공정 | UI **표준 점검 공정** 5단계 (URL → 점검 → 대시보드 → 비교 → CI) |
| 코드 최적화·동작 오류 체크 | 내장 51항목: 런타임(동작), 성능·링크·HTML(코드·품질), 보안, 접근성·SEO |
| 정성적 경험 → 자동화 | **체크리스트**(Admin) + 사이드바 **경험 → 자동화** — 수동·코드·Playwright 항목이 자동 점검으로 연결 |

체크리스트 관리: http://localhost:3000/admin.html

## 실행

```powershell
cd D:\dev\qa-adoption
npm install
npm start
```

http://localhost:3000 — URL 입력 후 **점검 시작**

## GitHub + Vercel 배포

[DEPLOY.md](./DEPLOY.md) 참고 — 저장소 push 후 Vercel에서 Import하면 됩니다.  
Vercel은 서버리스(Chromium 내장, 60초 제한, run 임시 저장)이며, 로컬과 동일한 장시간·배치 운영은 상시 서버(Railway 등)를 권장합니다.

Edge CDP(9222) 필요. `npm start` 시 디버깅 모드 자동 기동 시도.

## API

- `GET /api/checks` — 내장 점검 항목 목록
- `POST /api/runs` — 단일/배치 점검
  - 단일: `{ "url": "...", "mobile": true }`
  - URL 목록: `{ "mode": "list", "urlList": "https://a.com\nhttps://b.com", "mobile": true }`
  - Sitemap: `{ "mode": "sitemap", "url": "https://example.com", "maxPages": 20 }`
- `GET /api/runs/:id` — 결과 (배치는 `pages[]` 포함)
- `GET /api/runs/:id/diff` — 이전 run 대비 회귀 diff (`?compareTo=<runId>`로 비교 대상 지정)
- `GET /api/runs/:id/comparable` — 같은 URL(또는 배치 seed)의 비교 가능 run 목록
- `GET /api/runs/:id/trend?limit=10` — 동일 대상 최근 run pass/fail 추이
- `GET /api/runs/:id/screenshot` — 스크린샷

## 자동화 확장

### 모바일 뷰포트
- 기본 **데스크톱(1280) + 모바일(375)** 동시 점검 (`mobile: false`로 데스크톱만 가능)
- 모바일 항목은 결과 제목에 `(모바일)` 표시

### URL 목록 · Sitemap 크롤
- UI 탭: **단일 URL** / **URL 목록** / **Sitemap**
- Sitemap은 `robots.txt` → `sitemap.xml`에서 같은 origin URL 수집 (최대 50페이지)
- 배치 run: 페이지별 pass/fail 요약 + 상세 run 링크

### 이전 run diff (회귀)
- 같은 URL(또는 같은 sitemap seed)의 **직전 completed run**과 자동 비교
- **새 fail** = 이전엔 pass/skip → 지금 fail
- UI에 회귀 패널 표시, CI는 exit code 1

### CI / 스케줄
```powershell
# URL 목록 파일
npm run ci -- --urls checkgate-urls.example.txt

# Sitemap 크롤
npm run ci -- --url https://example.com --sitemap --max-pages 20
```

GitHub Actions: `.github/workflows/checkgate.yml` (주 1회 cron + 수동 실행)

환경 변수: `CHECKGATE_URLS` (줄바꿈 구분), `CHECKGATE_URL`

## Legacy

이전 TC 자동화 GUI: `/legacy/index.html`
