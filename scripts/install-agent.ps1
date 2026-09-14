param(
    [Parameter(Mandatory = $true)][string]$ServerUrl,
    [Parameter(Mandatory = $true)][string]$AgentToken,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$PcId,
    [string]$DisplayName = $env:COMPUTERNAME,
    [int]$IntervalSeconds = 10
)

$ErrorActionPreference = 'Stop'
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abrí PowerShell como administrador para instalar el agente.'
}

if ($ServerUrl -notmatch '^https?://[^/]+(?::\d+)?$') {
    throw 'ServerUrl debe verse como http://192.168.1.10:8787 (sin / al final).'
}
if ($IntervalSeconds -lt 5) { throw 'IntervalSeconds no puede ser menor que 5.' }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SourceAgent = Join-Path $ProjectRoot 'agent\inercia-agent.ps1'
$InstallDir = Join-Path $env:ProgramData 'InerciaFleet'
$InstalledAgent = Join-Path $InstallDir 'inercia-agent.ps1'
$ConfigPath = Join-Path $InstallDir 'config.json'

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -LiteralPath $SourceAgent -Destination $InstalledAgent -Force

@{
    serverUrl = $ServerUrl.TrimEnd('/')
    agentToken = $AgentToken
    pcId = $PcId.ToLowerInvariant()
    displayName = $DisplayName
    intervalSeconds = [Math]::Max(5, $IntervalSeconds)
} | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
& icacls.exe $ConfigPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstalledAgent -ConfigPath $ConfigPath -Once
if ($LASTEXITCODE -ne 0) { throw 'La prueba de conexión del agente falló.' }

$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstalledAgent`" -ConfigPath `"$ConfigPath`""
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
$Trigger = New-ScheduledTaskTrigger -AtStartup
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName 'Inercia Fleet Agent' -Action $Action -Trigger $Trigger -Principal $TaskPrincipal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName 'Inercia Fleet Agent'

Write-Host "Agente instalado: $DisplayName ($($PcId.ToLowerInvariant()))" -ForegroundColor Green
Write-Host 'La estación debe aparecer en el dashboard en menos de 15 segundos.'
