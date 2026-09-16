; Instalador del Servidor de Inercia Fleet.
; Compilar con: makensis installer\server.nsi
; Requiere que dist\server\InerciaFleetServer.exe exista (npm run build:server-exe).
;
; Instalación desatendida (para scripts de despliegue):
;   InerciaFleetServer-Setup.exe /S /PIN=tu-pin /PORT=8787
;
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Inercia Fleet Server"
OutFile "..\dist\installers\InerciaFleetServer-Setup.exe"
InstallDir "$PROGRAMFILES64\Inercia Fleet\Server"
InstallDirRegKey HKLM "Software\InerciaFleet\Server" "InstallDir"
RequestExecutionLevel admin
Unicode true
ShowInstDetails show
ShowUnInstDetails show

Var Dialog
Var PortLabel
Var PortText
Var PinLabel
Var PinText
Var PinConfirmLabel
Var PinConfirmText
Var Port
Var Pin
Var PowerShellExe

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom CredentialsPageCreate CredentialsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchDashboard
!define MUI_FINISHPAGE_RUN_TEXT "Abrir el panel de administración ahora"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
    StrCpy $Port "8787"
    StrCpy $Pin ""

    ; El instalador es un proceso de 32 bits: sin esto, $SYSDIR en Windows de 64
    ; bits queda redirigido por WOW64 a SysWOW64 y terminaríamos llamando al
    ; PowerShell de 32 bits, que puede fallar con algunos módulos (ScheduledTasks,
    ; NetSecurity). "sysnative" es la ruta virtual que Windows expone para que un
    ; proceso de 32 bits llegue al PowerShell nativo de 64 bits.
    ${If} ${FileExists} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $PowerShellExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${Else}
        StrCpy $PowerShellExe "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${EndIf}

    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} "$R0" "/PIN=" $R1
    ${IfNot} ${Errors}
        StrCpy $Pin $R1
    ${EndIf}
    ClearErrors
    ${GetOptions} "$R0" "/PORT=" $R1
    ${IfNot} ${Errors}
        StrCpy $Port $R1
    ${EndIf}
FunctionEnd

Function CredentialsPageCreate
    ; Instalación silenciosa (/S): si ya vino un PIN por línea de comandos, no
    ; mostramos la página, para poder desplegar el servidor sin intervención.
    ${If} ${Silent}
        Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
        Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "Puerto del panel (el mismo que van a usar los agentes). El valor por defecto sirve para casi todos los casos."
    Pop $PortLabel

    ${NSD_CreateText} 0 26u 100% 12u $Port
    Pop $PortText

    ${NSD_CreateLabel} 0 46u 100% 24u "PIN de administración: es la única credencial de todo el sistema. Lo vas a usar para entrar al panel y también para instalar cada agente."
    Pop $PinLabel

    ${NSD_CreateText} 0 72u 100% 12u $Pin
    Pop $PinText

    ${NSD_CreateLabel} 0 90u 100% 12u "Confirmá el PIN"
    Pop $PinConfirmLabel

    ${NSD_CreateText} 0 104u 100% 12u ""
    Pop $PinConfirmText

    nsDialogs::Show
FunctionEnd

Function CredentialsPageLeave
    ${NSD_GetText} $PortText $Port
    ${NSD_GetText} $PinText $Pin
    ${NSD_GetText} $PinConfirmText $R0

    ${If} $Port == ""
        StrCpy $Port "8787"
    ${EndIf}

    StrLen $R1 $Pin
    ${If} $R1 < 6
        MessageBox MB_ICONEXCLAMATION "El PIN debe tener al menos 6 caracteres."
        Abort
    ${EndIf}
    ${If} $Pin != $R0
        MessageBox MB_ICONEXCLAMATION "El PIN y su confirmación no coinciden."
        Abort
    ${EndIf}
FunctionEnd

Function LaunchDashboard
    ExecShell "open" "http://localhost:$Port"
FunctionEnd

Section "Instalar" SecInstall
    SetOutPath "$INSTDIR"
    File "..\dist\server\InerciaFleetServer.exe"
    File "..\config.example.json"

    SetOutPath "$INSTDIR\scripts"
    File "..\scripts\setup-server.ps1"
    File "..\scripts\uninstall-server.ps1"

    SetOutPath "$INSTDIR"

    ${If} $Pin == ""
        ; Instalación silenciosa sin /PIN=: no hay forma segura de generar un PIN
        ; sin que un humano lo sepa, así que directamente fallamos con un mensaje claro.
        ${If} ${Silent}
            DetailPrint "Falta /PIN= en la instalación silenciosa."
            Abort "Falta /PIN=tu-pin en la línea de comandos."
        ${EndIf}
    ${EndIf}

    DetailPrint "Configurando el servidor y el inicio automático..."
    nsExec::ExecToLog '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\setup-server.ps1" -AdminPin "$Pin" -Port $Port'
    Pop $R0
    ${If} $R0 != 0
        Abort "La configuración del servidor falló. Revisá los detalles arriba."
    ${EndIf}

    WriteRegStr HKLM "Software\InerciaFleet\Server" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\InerciaFleet\Server" "Port" "$Port"
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "DisplayName" "Inercia Fleet Server"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "Publisher" "Simuladores Inercia"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer" "NoRepair" 1
SectionEnd

Function un.onInit
    ${If} ${FileExists} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $PowerShellExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${Else}
        StrCpy $PowerShellExe "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${EndIf}
FunctionEnd

Section "Uninstall"
    nsExec::ExecToLog '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-server.ps1"'
    Pop $R0

    Delete "$INSTDIR\InerciaFleetServer.exe"
    Delete "$INSTDIR\config.example.json"
    Delete "$INSTDIR\scripts\setup-server.ps1"
    Delete "$INSTDIR\scripts\uninstall-server.ps1"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR\scripts"
    ; config.json y .data\ (PIN y registro de eventos) se conservan a propósito
    ; por si se trata de una reinstalación; se pueden borrar a mano si hace falta.
    RMDir "$INSTDIR"

    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetServer"
    DeleteRegKey HKLM "Software\InerciaFleet\Server"
SectionEnd
