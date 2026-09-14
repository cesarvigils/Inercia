$ErrorActionPreference = 'Stop'
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abrí PowerShell como administrador.'
}

Unregister-ScheduledTask -TaskName 'Inercia Fleet Agent' -Confirm:$false -ErrorAction SilentlyContinue
$InstallDir = Join-Path $env:ProgramData 'InerciaFleet'
if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
}
Write-Host 'Agente de Inercia desinstalado.' -ForegroundColor Green
