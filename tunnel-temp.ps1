#Requires -Version 5.0
[CmdletBinding()]
param(
  [int]$Port = 8080,
  # 留空 = 按阶梯自动尝试；显式指定则只跑这一档
  [ValidateSet('', 'http2', 'quic')]
  [string]$Protocol = '',
  [ValidateSet('', '4', '6', 'auto')]
  [string]$EdgeIp = '',
  [switch]$KeepLogs
)

$ErrorActionPreference = 'Stop'

# 可用 PM_CLOUDFLARED 覆盖；否则依次找 32 位 / 64 位安装目录与 PATH。
$Cloudflared = if ($env:PM_CLOUDFLARED) { $env:PM_CLOUDFLARED }
               elseif (Test-Path 'C:\Program Files (x86)\cloudflared\cloudflared.exe') { 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
               elseif (Test-Path 'C:\Program Files\cloudflared\cloudflared.exe') { 'C:\Program Files\cloudflared\cloudflared.exe' }
               elseif (Get-Command cloudflared -ErrorAction SilentlyContinue) { (Get-Command cloudflared).Source }
               else { 'cloudflared.exe' }
$LogDir = Join-Path $env:TEMP 'purple-music-logs'
# 排除 api.trycloudflare.com：那是申请接口的地址，不是隧道地址。
$UrlPattern = 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com'

function Write-Ok($text)   { Write-Host ('  [ OK ] ' + $text) -ForegroundColor Green }
function Write-Bad($text)  { Write-Host ('  [FAIL] ' + $text) -ForegroundColor Red }
function Write-Note($text) { Write-Host ('  [ !! ] ' + $text) -ForegroundColor Yellow }
function Write-Step($text) { Write-Host ('  ..     ' + $text) }
function Write-Dim($text)  { Write-Host ('         ' + $text) -ForegroundColor DarkGray }

Write-Host ''
Write-Host '  紫听歌嘞 / PURPLE MUSIC   临时公网地址' -ForegroundColor Magenta
Write-Host '  ======================================='

if (-not (Test-Path $Cloudflared)) { Write-Bad ('找不到 cloudflared: ' + $Cloudflared); exit 1 }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

try {
  $local = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/') -UseBasicParsing -TimeoutSec 5
  if ($local.StatusCode -eq 200) { Write-Ok ('本地服务 ' + $Port + ' 正常') }
} catch {
  Write-Bad ('本地 ' + $Port + ' 没有响应，先双击 start.cmd')
  exit 1
}

# 一档 = 一种「协议 + 边缘 IP 版本」组合。实测这条宽带上 http2(TCP 7844) 的 TLS
# 握手会被中间设备直接 EOF 掉，重试到最后 Cloudflare 会回收隧道注册，公网就报
# Error 1033；而 QUIC(UDP 7844) 一秒就能注册成功。所以 quic 打头，万一哪天 UDP
# 被封再回落 http2。逐档试，直到隧道真的注册上为止。
if ($Protocol -or $EdgeIp) {
  $proto = if ($Protocol) { $Protocol } else { 'quic' }
  $ladder = @(@{ Name = ('手动指定 ' + $proto + ' / IP' + $(if ($EdgeIp) { $EdgeIp } else { 'auto' })); Proto = $proto; Ip = $EdgeIp })
} else {
  $ladder = @(
    @{ Name = 'quic / 自动选 IP';  Proto = 'quic';  Ip = '' },
    @{ Name = 'quic / IPv4 边缘';  Proto = 'quic';  Ip = '4' },
    @{ Name = 'http2 / 自动选 IP'; Proto = 'http2'; Ip = '' },
    @{ Name = 'http2 / IPv6 边缘'; Proto = 'http2'; Ip = '6' }
  )
}

$script:proc = $null
$url = $null
$okStrategy = $null
$lastReason = ''

function Read-Log($path) {
  try { return Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue } catch { return '' }
}

function Stop-Tunnel {
  if ($script:proc -and -not $script:proc.HasExited) {
    Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue
  }
}

foreach ($step in $ladder) {
  $stamp = Get-Date -Format 'MMdd-HHmmss'
  $errLog = Join-Path $LogDir ('quicktunnel-' + $stamp + '.err.log')
  $outLog = Join-Path $LogDir ('quicktunnel-' + $stamp + '.out.log')

  $cfArgs = @('tunnel', '--url', ('http://127.0.0.1:' + $Port), '--protocol', $step.Proto)
  if ($step.Ip) { $cfArgs += @('--edge-ip-version', $step.Ip) }

  Write-Step ('尝试 ' + $step.Name)
  $script:proc = Start-Process -FilePath $Cloudflared -ArgumentList $cfArgs `
    -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  # 第一步：拿到分配的地址
  $candidate = $null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    $text = Read-Log $errLog
    if ($text) {
      $match = [regex]::Match($text, $UrlPattern)
      if ($match.Success) { $candidate = $match.Value; break }
      if ($text -match 'failed to request quick Tunnel') { break }
    }
    if ($script:proc.HasExited) { break }
  }

  if (-not $candidate) {
    $lastReason = '申请地址失败（到 api.trycloudflare.com 不通）'
    Write-Note $lastReason
    Stop-Tunnel
    continue
  }

  # 第二步：等隧道真正注册到边缘。只看到地址不代表能用 —— 这正是 Error 1033 的成因。
  $registered = $false
  $handshakeFails = 0
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    $text = Read-Log $errLog
    if ($text) {
      if ($text -match 'Registered tunnel connection') { $registered = $true; break }
      $handshakeFails = ([regex]::Matches($text, 'TLS handshake with edge error|failed to dial to edge|no more connections active')).Count
    }
    if ($script:proc.HasExited) { break }
  }

  if (-not $registered) {
    $lastReason = ('隧道没能连上边缘（握手失败 ' + $handshakeFails + ' 次）')
    Write-Note $lastReason
    Write-Dim ('日志 ' + $errLog)
    Stop-Tunnel
    continue
  }

  Write-Ok ('隧道已连上边缘：' + $candidate)

  # 第三步：真的请求一次公网地址，确认边缘能解析（1033 就是这一步过不去）。
  Write-Step '校验公网可达（边缘生效通常要十几秒）'
  $reachable = $false
  for ($i = 0; $i -lt 8; $i++) {
    Start-Sleep -Seconds 4
    try {
      $probe = Invoke-WebRequest -Uri $candidate -UseBasicParsing -TimeoutSec 12
      if ([int]$probe.StatusCode -lt 500) { $reachable = $true; break }
    } catch {
      $code = 0
      if ($_.Exception.Response) { try { $code = [int]$_.Exception.Response.StatusCode } catch { } }
      # 530 = Cloudflare 1033，隧道还没被边缘认出来，继续等
      if ($code -gt 0 -and $code -lt 500) { $reachable = $true; break }
    }
  }

  if ($reachable) { $url = $candidate; $okStrategy = $step.Name; break }

  $lastReason = '边缘仍返回 1033（隧道注册上了但没被路由）'
  Write-Note $lastReason
  Stop-Tunnel
}

if (-not $url) {
  Write-Host ''
  Write-Bad '四种组合都没打通，暂时拿不到可用的公网地址'
  Write-Host ''
  Write-Dim ('最后一次失败原因：' + $lastReason)
  Write-Dim '「TLS handshake with edge error: EOF」= TCP 能连到 Cloudflare 边缘，但 TLS 握手被中途掐断，'
  Write-Dim '通常是当前网络（运营商 / 网关 / 校园网）在干扰 7844 端口，不是本项目或 cloudflared 的问题。'
  Write-Host ''
  Write-Dim '可以试：1) 换网络，手机热点最快验证；2) 隔一段时间再跑；3) 想要固定地址就用带域名的命名隧道。'
  Write-Dim ('日志目录 ' + $LogDir)
  Write-Host ''
  exit 1
}

try { Set-Clipboard -Value $url; $copied = '（已复制到剪贴板）' } catch { $copied = '' }

Write-Host ''
Write-Ok ('公网访问已生效 · ' + $okStrategy)
Write-Host ''
Write-Host ('  >>>  ' + $url) -ForegroundColor Cyan
Write-Host ('       手机或别人的电脑都能打开 ' + $copied)
Write-Host ''
Write-Note '这个地址完全公开、没有任何鉴权，而服务端内存里存着你的登录会话。'
Write-Note '测完立刻关窗口；不要在暴露期间长时间保持登录。'
Write-Host ''
Write-Host '  地址仅在本窗口开着时有效，关窗口或 Ctrl+C 即断开；重开会换一个新地址。' -ForegroundColor DarkGray
Write-Host ''

try {
  while (-not $script:proc.HasExited) { Start-Sleep -Seconds 1 }
  Write-Note 'cloudflared 自己退出了，隧道已断开'
} finally {
  if ($script:proc -and -not $script:proc.HasExited) {
    Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Ok '临时隧道已关闭'
  }
  if (-not $KeepLogs) {
    Get-ChildItem -LiteralPath $LogDir -Filter 'quicktunnel-*' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -Skip 6 |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}