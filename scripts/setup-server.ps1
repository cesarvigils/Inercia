param(
    [string]$AdminPin,
    [int]$Port = 8787,
    [switch]$SkipFirewall,
    [switch]$NoService
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot 'config.json'
$ExamplePath = Join-Path $ProjectRoot 'config.example.json'

function Test-Administrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 o superior no está instalado o no está en PATH.'
}

$NodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 20) { throw 'Se requiere Node.js 20 o superior.' }

if (-not $AdminPin) {
    $AdminPin = Read-Host 'Creá un PIN de administración (mínimo 6 caracteres)'
}
if ($AdminPin.Length -lt 6 -or $AdminPin -eq 'CHANGE-ME') {
    throw 'El PIN debe tener al menos 6 caracteres y no puede ser CHANGE-ME.'
}

$Random = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Random)
$AgentToken = [Convert]::ToBase64String($Random).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$Config = Get-Content -LiteralPath $ExamplePath -Raw | ConvertFrom-Json
$Config.port = $Port
$Config.adminPin = $AdminPin
$Config.agentToken = $AgentToken
$Config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
& icacls.exe $ConfigPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null

if (-not $SkipFirewall) {
    $RuleName = 'Inercia Fleet Dashboard (LAN)'
    Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet | Out-Null
}

if (-not $NoService) {
    if (-not (Test-Administrator)) { throw 'Abrí PowerShell como administrador para instalar el inicio automático.' }
    $NodePath = (Get-Command node.exe).Source
    $Action = New-ScheduledTaskAction -Execute $NodePath -Argument 'server.js' -WorkingDirectory $ProjectRoot
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'Inercia Fleet Server' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
    Start-ScheduledTask -TaskName 'Inercia Fleet Server'
}

$LanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Inercia Control quedó configurado.' -ForegroundColor Green
Write-Host "Dashboard: http://${LanIp}:$Port"
Write-Host "PIN: $AdminPin"
Write-Host "Agent token: $AgentToken"
Write-Host ''
Write-Host 'Guardá el agent token: lo necesitarás al instalar cada PC.' -ForegroundColor Yellow
