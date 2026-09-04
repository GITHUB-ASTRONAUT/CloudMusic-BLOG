#Requires -Version 5.0
[CmdletBinding()]
param(
  [switch]$Restart,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$Root   = $PSScriptRoot
# 可用环境变量覆盖：PM_API_DIR 指向 api-enhanced 目录，PM_NODE 指向 node.exe。
$ApiDir = if ($env:PM_API_DIR) { $env:PM_API_DIR } else { Join-Path $env:USERPROFILE 'api-enhanced' }
$Node   = if ($env:PM_NODE) { $env:PM_NODE }
          elseif (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source }
          else { 'C:\Program Files\nodejs\node.exe' }
$LogDir = Join-Path $env:TEMP 'purple-music-logs'
$ApiPing = 'http://127.0.0.1:3000/search?keywords=test&limit=1'

function Write-Step($text) { Write-Host ('  ..     ' + $text) }
function Write-Ok($text)   { Write-Host ('  [ OK ] ' + $text) -ForegroundColor Green }
function Write-Bad($text)  { Write-Host ('  [FAIL] ' + $text) -ForegroundColor Red }
function Write-Note($text) { Write-Host ('  [ !! ] ' + $text) -ForegroundColor Yellow }

function Get-ListenerPid([int]$Port) {
  $rows = netstat -ano | Select-String ('TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)')
  foreach ($row in $rows) { return [int]$row.Matches[0].Groups[1].Value }
  return 0
}

function Test-Url([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return ($response.StatusCode -eq 200)
  } catch { return $false }
}

function Wait-Url([string]$Url, [int]$Seconds = 20) {
  for ($i = 0; $i -lt ($Seconds * 2); $i++) {
    if (Test-Url $Url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# 只停 node 进程：端口若被别的程序占着，宁可报错也不乱杀。
function Stop-Listener([int]$Port, [string]$Label) {
  $listenerPid = Get-ListenerPid $Port
  if ($listenerPid -le 0) { return }
  $proc = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $listenerPid -Force
    Write-Step ($Label + ' 旧进程已停止 (PID ' + $listenerPid + ')')
    Start-Sleep -Milliseconds 700
  } else {
    Write-Note ($Port.ToString() + ' 端口被非 node 进程占用 (PID ' + $listenerPid + ')，已跳过')
  }
}

function Start-Node([string]$WorkDir, [string]$Script, [string]$LogName) {
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $outLog = Join-Path $LogDir ($LogName + '.out.log')
  $errLog = Join-Path $LogDir ($LogName + '.err.log')
  Start-Process -FilePath $Node -ArgumentList $Script -WorkingDirectory $WorkDir `
    -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

Write-Host ''
Write-Host '  紫听歌嘞 / PURPLE MUSIC   一键启动' -ForegroundColor Magenta
Write-Host '  ==================================='

# ---- 0. 前置检查 ----
if (-not (Test-Path $Node)) { Write-Bad ('找不到 node.exe: ' + $Node); exit 1 }
if (-not (Test-Path (Join-Path $ApiDir 'app.js'))) { Write-Bad ('找不到音乐 API 项目: ' + $ApiDir); exit 1 }
if (-not (Test-Path (Join-Path $Root 'server.mjs'))) { Write-Bad ('这里不是项目根目录: ' + $Root); exit 1 }

if ($Restart) {
  Write-Step '按 -Restart 要求，先停掉旧进程'
  Stop-Listener 8080 '静态服务'
  Stop-Listener 3000 '音乐 API'
}

# ---- 1. 音乐 API (3000) ----
if (Test-Url $ApiPing) {
  Write-Ok '音乐 API  3000  已在运行'
} else {
  Write-Step '启动音乐 API  (node app.js)'
  Stop-Listener 3000 '音乐 API'
  Start-Node $ApiDir 'app.js' 'api'
  if (Wait-Url $ApiPing 30) {
    Write-Ok '音乐 API  3000  就绪'
  } else {
    Write-Bad ('音乐 API 起不来，日志: ' + (Join-Path $LogDir 'api.err.log'))
    exit 1
  }
}

# ---- 2. 静态服务 + 代理 (8080) ----
if (Test-Url 'http://127.0.0.1:8080/') {
  Write-Ok '静态服务  8080  已在运行'
} else {
  Write-Step '启动静态服务  (node server.mjs)'
  Stop-Listener 8080 '静态服务'
  Start-Node $Root 'server.mjs' 'static'
  if (Wait-Url 'http://127.0.0.1:8080/' 20) {
    Write-Ok '静态服务  8080  就绪'
  } else {
    Write-Bad ('静态服务起不来，日志: ' + (Join-Path $LogDir 'static.err.log'))
    exit 1
  }
}

# ---- 3. 代理链路自检（替代你手动确认那一步）----
try {
  $probe = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/search?keywords=test&limit=1' -UseBasicParsing -TimeoutSec 10
  $data = $probe.Content | ConvertFrom-Json
  if ($data.code -eq 200) {
    Write-Ok 'api proxy  /api/*  ->  http://127.0.0.1:3000  正常'
  } else {
    Write-Bad ('代理通了但上游返回 code=' + $data.code)
  }
} catch {
  Write-Bad ('代理自检失败: ' + $_.Exception.Message)
}

# ---- 4. 公网入口 ----
$svc = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if ($null -eq $svc) {
  Write-Note 'cloudflared 服务未安装，公网访问不可用（安装见 DEPLOY.md，只需一次）'
} elseif ($svc.Status -eq 'Running') {
  Write-Ok ('cloudflared 服务运行中，启动类型 ' + $svc.StartType + '（开机自启，不用每次装）')
} else {
  Write-Step 'cloudflared 服务没在跑，尝试启动'
  try {
    Start-Service -Name 'Cloudflared'
    Write-Ok 'cloudflared 已启动'
  } catch {
    Write-Note '启动 cloudflared 需要管理员：右键本脚本以管理员运行，或执行  net start Cloudflared'
  }
}

Write-Host ''
Write-Host '  本地地址   http://127.0.0.1:8080' -ForegroundColor Cyan
Write-Host '  查看日志   ' -NoNewline; Write-Host $LogDir -ForegroundColor DarkGray
Write-Host '  停止服务   双击 stop.cmd'
Write-Host ''

if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8080/' }
