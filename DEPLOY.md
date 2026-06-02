# CheckGate — GitHub + Vercel 배포

## 사전 안내

| 환경 | 동작 |
|------|------|
| **로컬** (`npm start`) | Edge CDP 또는 Chromium, 배치·모바일 뷰포트, run 기록 유지 |
| **Vercel** | 서버리스 Chromium, **단일 URL 위주**, 점검 끝난 뒤 응답(최대 60초), run 데이터는 **임시(/tmp)** |

Vercel에서는 배치·Sitemap **최대 5페이지**, **데스크톱 뷰포트만** 기본입니다. (타임아웃·용량 제한)

---

## 1. GitHub에 올리기

```powershell
cd D:\dev\qa-adoption
git init
git add .
git commit -m "CheckGate: URL 점검 도구"
```

GitHub에서 **새 저장소** 생성 (예: `checkgate`) 후:

```powershell
git remote add origin https://github.com/<사용자명>/checkgate.git
git branch -M main
git push -u origin main
```

`.gitignore`에 `node_modules`, `data/runs`, `test-results` 등이 포함되어 있습니다.

---

## 2. Vercel 연결

1. [vercel.com](https://vercel.com) 로그인 → **Add New Project**
2. GitHub 저장소 **Import**
3. 설정 (기본값으로 대부분 가능):
   - **Framework Preset**: Other
   - **Root Directory**: `.`
   - **Build Command**: (비워두거나 `echo checkgate`)
   - **Output Directory**: (비움 — API가 정적+API 모두 처리)
4. **Deploy**

`vercel.json`이 함수 타임아웃(60초)·메모리(**2048MB**, Hobby 상한)를 지정합니다.  
Pro(Team) 플랜이면 메모리·실행 시간을 더 늘릴 수 있습니다.

---

## 3. 배포 후 확인

- `https://<프로젝트>.vercel.app` — CheckGate UI
- URL 입력 → **점검 시작** (완료까지 로딩 후 결과 표시)
- **이전 점검과 비교 / 추이**는 같은 배포 인스턴스의 `/tmp` run만 사용 (재배포·콜드스타트 시 이전 기록 없음)

---

## 4. 로컬 vs Vercel

| 항목 | 로컬 | Vercel |
|------|------|--------|
| 브라우저 | Edge CDP → 실패 시 Chromium | @sparticuz/chromium |
| 점검 방식 | 백그라운드 + 폴링 | 요청 안에서 동기 실행 |
| run 저장 | `data/runs/` | `/tmp` (휘발) |
| 모바일 뷰포트 | 기본 ON | 기본 OFF |
| 배치 최대 | 50 URL | 5 URL |

---

## 5. 문제 해결

- **504 / 타임아웃**: 느린 사이트·항목 많음 → Pro에서 `maxDuration` 증가 또는 단일 URL만 사용
- **점검 실패 (브라우저)**: Vercel 로그(Functions)에서 Chromium 오류 확인
- **비교·추이 비어 있음**: Vercel은 같은 인스턴스에서 2회 이상 점검해야 의미 있음 (영구 저장 없음)

영구 run 저장·긴 배치가 필요하면 **Railway / Render / Fly.io** 등 상시 Node 서버 배포를 권장합니다.
