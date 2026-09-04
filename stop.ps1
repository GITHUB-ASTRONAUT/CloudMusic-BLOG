#Requires -Version 5.0
[CmdletBinding()]
param(
  [switch]$Tunnel
)

$ErrorActionPreference = 'Stop'

function Write-Ok($text)   { Write-Host ('  [ OK ] ' + $text) -ForegroundColor Green }
function Write-Note($text) { Write-Host ('  [ !! ] ' + $text) -ForegroundColor Yellow }

function Get-ListenerPid([int]$Port) {
  $rows = netstat -ano | Select-String ('TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)')
  foreach ($row in $rows) { return [int]$row.Matches[0].Groups[1].Value }
  return 0
}

function Stop-Listener([int]$Port, [string]$Label) {
  $listenerPid = Get-ListenerPid $Port
  if ($listenerPid -le 0) {
    Write-Ok ($Label + ' ' + $Port + ' 本来就没在跑')
    return
  }
  $proc = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $listenerPid -Force
    Write-Ok ($Label + ' ' + $Port + ' 已停止 (PID ' + $listenerPid + ')')
  } else {
    Write-Note ($Port.ToString() + ' 端口被非 node 进程占用 (PID ' + $listenerPid + ')，没有动它')
  }
}

Write-Host ''
Write-Host '  紫听歌嘞 / PURPLE MUSIC   停止服务' -ForegroundColor Magenta
Write-Host '  ==================================='

Stop-Listener 8080 '静态服务'
Stop-Listener 3000 '音乐 API '

if ($Tunnel) {
  try {
    Stop-Service -Name 'Cloudflared' -ErrorAction Stop
    Write-Ok 'cloudflared 服务已停止'
  } catch {
    Write-Note '停止 cloudflared 需要管理员：net stop Cloudflared'
  }
} else {
  Write-Host ''
  Write-Host '  cloudflared 服务保持运行（它只是隧道，没有后端时对外返回 502）。' -ForegroundColor DarkGray
  Write-Host '  想一起停：stop.cmd -Tunnel（需要管理员）' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  注意：登录凭证只存在服务进程内存里，停掉之后需要重新扫码登录。' -ForegroundColor Yellow
Write-Host ''
