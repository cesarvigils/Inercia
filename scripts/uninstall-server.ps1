$ErrorActionPreference = 'Stop'
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abrí PowerShell como administrador.'
}

Stop-ScheduledTask -TaskName 'Inercia Fleet Server' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Inercia Fleet Server' -Confirm:$false -ErrorAction SilentlyContinue

$RuleName = 'Inercia Fleet Dashboard (LAN)'
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

Write-Host 'Servidor de Inercia Fleet desinstalado.' -ForegroundColor Green
