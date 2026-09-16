param(
    [string]$ConfigPath = "$env:ProgramData\InerciaFleet\config.json",
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '2.0.0'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "No se encontró la configuración del agente: $ConfigPath"
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$ServerUrl = ([string]$Config.serverUrl).TrimEnd('/')
# El agente se autentica con el mismo PIN configurado en el panel de administración
# del servidor: no hay un token separado que generar, copiar ni resincronizar.
$Pin = [string]$Config.pin
$PcId = [string]$Config.pcId
$DisplayName = [string]$Config.displayName
$IntervalSeconds = if ($Config.intervalSeconds) { [Math]::Max(5, [int]$Config.intervalSeconds) } else { 10 }

if (-not $ServerUrl -or -not $Pin -or -not $PcId) {
    throw 'La configuración requiere serverUrl, pin y pcId.'
}

$Headers = @{ Authorization = "Bearer $Pin" }

function Get-PrimaryIPv4 {
    try {
        $Address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Sort-Object InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($Address) { return [string]$Address }
    } catch {}
    return ''
}

function Get-PendingReboot {
    $WindowsUpdateReboot = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    $PendingRename = $false
    try {
        $PendingRename = $null -ne (Get-ItemPropertyValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name 'PendingFileRenameOperations' -ErrorAction Stop)
    } catch {}
    return $WindowsUpdateReboot -or $PendingRename
}

function Get-Telemetry {
    $OperatingSystem = Get-CimInstance Win32_OperatingSystem
    $Computer = Get-CimInstance Win32_ComputerSystem
    $Processor = Get-CimInstance Win32_Processor | Select-Object -First 1
    $Disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $GpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join ', '
    $Uptime = ((Get-Date) - $OperatingSystem.LastBootUpTime).TotalSeconds
    $MemoryTotalGb = [Math]::Round($OperatingSystem.TotalVisibleMemorySize / 1MB, 1)
    $MemoryUsedGb = [Math]::Round(($OperatingSystem.TotalVisibleMemorySize - $OperatingSystem.FreePhysicalMemory) / 1MB, 1)

    return @{
        pcId = $PcId
        name = if ($DisplayName) { $DisplayName } else { $env:COMPUTERNAME }
        ip = Get-PrimaryIPv4
        agentVersion = $AgentVersion
        stats = @{
            os = [string]$OperatingSystem.Caption
            model = (([string]$Computer.Manufacturer + ' ' + [string]$Computer.Model).Trim())
            loggedInUser = [string]$Computer.UserName
            cpuName = [string]$Processor.Name
            cpuPercent = [double]$Processor.LoadPercentage
            memoryTotalGb = $MemoryTotalGb
            memoryUsedGb = $MemoryUsedGb
            diskTotalGb = if ($Disk.Size) { [Math]::Round($Disk.Size / 1GB, 1) } else { $null }
            diskFreeGb = if ($Disk.FreeSpace) { [Math]::Round($Disk.FreeSpace / 1GB, 1) } else { 0 }
            gpuName = $GpuNames
            uptimeSeconds = [Math]::Round($Uptime)
            pendingReboot = Get-PendingReboot
        }
    }
}

function Send-JsonPost {
    param([string]$Path, [object]$Body)
    return Invoke-RestMethod -Uri "$ServerUrl$Path" -Method Post -Headers $Headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress -Depth 5) -TimeoutSec 6
}

function Invoke-CheckIn {
    $Telemetry = Get-Telemetry
    Send-JsonPost -Path '/api/agent/check-in' -Body $Telemetry | Out-Null
}

function Send-CommandResult {
    param([string]$CommandId, [string]$Status, [string]$Message)
    try {
        Send-JsonPost -Path '/api/agent/command-result' -Body @{
            pcId = $PcId
            commandId = $CommandId
            status = $Status
            message = $Message
        } | Out-Null
    } catch {
        Write-Warning "No se pudo confirmar el comando: $($_.Exception.Message)"
    }
}

function Invoke-PendingCommand {
    try {
        $EncodedPcId = [Uri]::EscapeDataString($PcId)
        $Response = Invoke-RestMethod -Uri "$ServerUrl/api/agent/commands?pcId=$EncodedPcId" -Method Get -Headers $Headers -TimeoutSec 6
        if (-not $Response.command) { return }

        switch ([string]$Response.command.type) {
            'shutdown' {
                try {
                    $Process = Start-Process -FilePath "$env:SystemRoot\System32\shutdown.exe" -ArgumentList @('/s', '/t', '20', '/c', 'Apagado remoto programado por Inercia Control.') -WindowStyle Hidden -PassThru -Wait
                    if ($Process.ExitCode -ne 0) { throw "shutdown.exe devolvió código $($Process.ExitCode)" }
                    Send-CommandResult -CommandId $Response.command.id -Status 'accepted' -Message 'Windows aceptó el apagado con 20 segundos de aviso.'
                } catch {
                    Send-CommandResult -CommandId $Response.command.id -Status 'failed' -Message $_.Exception.Message
                }
            }
            default {
                Send-CommandResult -CommandId $Response.command.id -Status 'failed' -Message 'Tipo de comando no permitido.'
            }
        }
    } catch {
        Write-Warning "No se pudo consultar comandos: $($_.Exception.Message)"
    }
}

if ($Once) {
    Invoke-CheckIn
    exit 0
}

do {
    try {
        Invoke-CheckIn
        Invoke-PendingCommand
    } catch {
        Write-Warning "No se pudo reportar al servidor: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
