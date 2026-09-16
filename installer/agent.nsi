; Instalador del Agente de Inercia Fleet (una PC de simulador).
; Compilar con: makensis installer\agent.nsi
;
; Instalación desatendida, para instalar la flota entera sin abrir el asistente
; en cada PC (por ejemplo desde un script de despliegue o PsExec):
;   InerciaFleetAgent-Setup.exe /S /SERVERURL=http://192.168.20.10:8787 /PIN=tu-pin /NAME=Simulador-05
;
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Inercia Fleet Agent"
OutFile "..\dist\installers\InerciaFleetAgent-Setup.exe"
InstallDir "$PROGRAMFILES64\Inercia Fleet\Agent"
InstallDirRegKey HKLM "Software\InerciaFleet\Agent" "InstallDir"
RequestExecutionLevel admin
Unicode true
ShowInstDetails show
ShowUnInstDetails show

Var Dialog
Var ServerLabel
Var ServerText
Var PinLabel
Var PinText
Var NameLabel
Var NameText
Var ServerUrl
Var Pin
Var DisplayName
Var PowerShellExe

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!insertmacro MUI_PAGE_WELCOME
Page custom CredentialsPageCreate CredentialsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
    StrCpy $ServerUrl ""
    StrCpy $Pin ""
    ExpandEnvStrings $DisplayName "%COMPUTERNAME%"

    ; Ver el comentario equivalente en server.nsi: evita que un instalador de 32
    ; bits termine llamando al PowerShell de 32 bits por la redirección de WOW64.
    ${If} ${FileExists} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $PowerShellExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${Else}
        StrCpy $PowerShellExe "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${EndIf}

    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} "$R0" "/SERVERURL=" $R1
    ${IfNot} ${Errors}
        StrCpy $ServerUrl $R1
    ${EndIf}
    ClearErrors
    ${GetOptions} "$R0" "/PIN=" $R1
    ${IfNot} ${Errors}
        StrCpy $Pin $R1
    ${EndIf}
    ClearErrors
    ${GetOptions} "$R0" "/NAME=" $R1
    ${IfNot} ${Errors}
        StrCpy $DisplayName $R1
    ${EndIf}
FunctionEnd

Function CredentialsPageCreate
    ${If} ${Silent}
        Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
        Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "Dirección del servidor (la que muestra el instalador del servidor), por ejemplo http://192.168.20.10:8787"
    Pop $ServerLabel

    ${NSD_CreateText} 0 22u 100% 12u $ServerUrl
    Pop $ServerText

    ${NSD_CreateLabel} 0 40u 100% 20u "PIN de administración del servidor (el mismo que se usa para entrar al panel)."
    Pop $PinLabel

    ${NSD_CreateText} 0 62u 100% 12u $Pin
    Pop $PinText

    ${NSD_CreateLabel} 0 80u 100% 20u "Nombre de esta estación en el panel (podés dejarlo así o cambiarlo, por ejemplo Simulador 05)."
    Pop $NameLabel

    ${NSD_CreateText} 0 102u 100% 12u $DisplayName
    Pop $NameText

    nsDialogs::Show
FunctionEnd

Function CredentialsPageLeave
    ${NSD_GetText} $ServerText $ServerUrl
    ${NSD_GetText} $PinText $Pin
    ${NSD_GetText} $NameText $DisplayName

    ${If} $ServerUrl == ""
        MessageBox MB_ICONEXCLAMATION "Falta la dirección del servidor."
        Abort
    ${EndIf}
    StrLen $R1 $Pin
    ${If} $R1 < 4
        MessageBox MB_ICONEXCLAMATION "El PIN parece inválido."
        Abort
    ${EndIf}
    ${If} $DisplayName == ""
        ExpandEnvStrings $DisplayName "%COMPUTERNAME%"
    ${EndIf}
FunctionEnd

Section "Instalar" SecInstall
    ${If} $ServerUrl == ""
    ${OrIf} $Pin == ""
        ${If} ${Silent}
            DetailPrint "Faltan /SERVERURL= y/o /PIN= en la instalación silenciosa."
            Abort "Uso: /S /SERVERURL=http://IP:8787 /PIN=tu-pin [/NAME=Nombre]"
        ${EndIf}
    ${EndIf}

    SetOutPath "$INSTDIR\agent"
    File "..\agent\inercia-agent.ps1"

    SetOutPath "$INSTDIR\scripts"
    File "..\scripts\install-agent.ps1"
    File "..\scripts\uninstall-agent.ps1"

    SetOutPath "$INSTDIR"

    DetailPrint "Registrando el agente y probando la conexión con el servidor..."
    nsExec::ExecToLog '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-agent.ps1" -ServerUrl "$ServerUrl" -Pin "$Pin" -DisplayName "$DisplayName"'
    Pop $R0
    ${If} $R0 != 0
        Abort "No se pudo conectar con el servidor. Revisá la dirección y el PIN, y volvé a intentar."
    ${EndIf}

    WriteRegStr HKLM "Software\InerciaFleet\Agent" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\InerciaFleet\Agent" "ServerUrl" "$ServerUrl"
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "DisplayName" "Inercia Fleet Agent"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "Publisher" "Simuladores Inercia"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent" "NoRepair" 1
SectionEnd

Function un.onInit
    ${If} ${FileExists} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $PowerShellExe "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${Else}
        StrCpy $PowerShellExe "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${EndIf}
FunctionEnd

Section "Uninstall"
    nsExec::ExecToLog '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-agent.ps1"'
    Pop $R0

    Delete "$INSTDIR\agent\inercia-agent.ps1"
    Delete "$INSTDIR\scripts\install-agent.ps1"
    Delete "$INSTDIR\scripts\uninstall-agent.ps1"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR\agent"
    RMDir "$INSTDIR\scripts"
    RMDir "$INSTDIR"

    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\InerciaFleetAgent"
    DeleteRegKey HKLM "Software\InerciaFleet\Agent"
SectionEnd
