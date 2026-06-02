# Edge 브라우저를 디버깅 모드(CDP)로 실행하는 스크립트
# QA 테스트 실행 전에 이 스크립트를 먼저 실행해 두세요. (실행 전 기존 Edge 창은 닫는 것을 권장)

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
    $edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}
$userDataDir = "$env:TEMP\edge-debug-profile"
$port = 9222

if (-not (Test-Path $edgePath)) {
    Write-Host "Edge executable not found." -ForegroundColor Red
    exit 1
}

Write-Host "Launching Edge in debugging mode on port $port..." -ForegroundColor Cyan
Write-Host "UserDataDir: $userDataDir" -ForegroundColor Gray

if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
}

Start-Process -FilePath $edgePath -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$userDataDir", "--no-first-run", "--no-default-browser-check"

Write-Host "Browser launched. You can now run QA tests from the GUI (http://localhost:3000)." -ForegroundColor Green
