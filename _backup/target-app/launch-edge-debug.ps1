# Edge 브라우저를 디버깅 모드로 실행하는 스크립트
# 실행 전 모든 Edge 창을 닫아주세요.

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$userDataDir = "$env:TEMP\edge-debug-profile"
$port = 9222

if (-not (Test-Path $edgePath)) {
    Write-Host "Edge executable not found at $edgePath" -ForegroundColor Red
    exit 1
}

Write-Host "Launching Edge in debugging mode on port $port..." -ForegroundColor Cyan
Write-Host "UserDataDir: $userDataDir" -ForegroundColor Gray

# 사용자 데이터 디렉터리가 없으면 생성 (선택 사항, 브라우저가 알아서 함)
if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Path $userDataDir | Out-Null
}

Start-Process -FilePath $edgePath -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$userDataDir", "--no-first-run", "--no-default-browser-check"

Write-Host "Browser launched. You can now run Playwright tests." -ForegroundColor Green
