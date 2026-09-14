# Manejo de PC's Inercia

Dashboard local y liviano para monitorear las PCs de Simuladores Inercia y apagarlas de forma individual o conjunta.

## Arquitectura

- **Servidor:** Node.js 20, sin paquetes externos ni base de datos. Mantiene el estado actual en memoria y un registro pequeño en `.data/events.jsonl`.
- **Agente:** PowerShell en cada PC Windows. Envía telemetría por HTTP saliente y consulta únicamente comandos permitidos.
- **Interfaz:** HTML, CSS y JavaScript nativos con actualizaciones en vivo por Server-Sent Events.
- **Acceso:** PIN de administración, cookie HttpOnly y token separado para los agentes.

El servidor ejecuta un solo proceso Node y no necesita una base de datos, framework web ni procesos auxiliares.

## Instalación del servidor Windows

1. Instalá [Node.js 20 LTS o superior](https://nodejs.org/) en la PC que funcionará como servidor.
2. Descomprimí esta carpeta en una ruta fija, por ejemplo `C:\InerciaFleet`.
3. Abrí PowerShell **como administrador** en esa carpeta y ejecutá:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-server.ps1
```

El instalador:

- solicita un PIN;
- genera un token seguro para los agentes;
- limita la regla de Windows Firewall a `LocalSubnet`;
- registra el servidor para iniciar automáticamente con Windows;
- muestra la URL local, normalmente `http://IP-DEL-SERVIDOR:8787`.

Guardá el `Agent token` que muestra al terminar. Para cambiar nombres, estaciones o proteger otra PC, editá `config.json` y reiniciá la tarea **Inercia Fleet Server**.

## Instalación en cada PC

Copiá temporalmente esta carpeta a la PC y abrí PowerShell como administrador. Cambiá la IP, token, ID y nombre:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-agent.ps1 `
  -ServerUrl "http://192.168.20.10:8787" `
  -AgentToken "TOKEN_GENERADO_EN_EL_SERVIDOR" `
  -PcId "sim-01" `
  -DisplayName "Simulador 01"
```

Usá un `PcId` distinto para cada estación, de `sim-01` a `sim-10`. El agente prueba la conexión antes de instalar la tarea de inicio automático.

Para desinstalarlo:

```powershell
.\scripts\uninstall-agent.ps1
```

## Uso diario

Abrí la URL local del servidor desde una PC de administración, ingresá el PIN y revisá las estaciones. Una estación pasa a **Offline** si no reporta durante 25 segundos.

- **Apagar una PC:** botón `Apagar` en su tarjeta y segunda confirmación en el modal.
- **Apagar todas:** botón superior `Apagar PCs`; se debe escribir `APAGAR TODO`.
- Las PCs con `"protected": true` nunca reciben una orden desde el apagado general.
- Windows muestra un aviso de 20 segundos antes de apagar. En ese intervalo se puede cancelar localmente con `shutdown /a`.

## Probar sin apagar equipos

Después de configurar el servidor, abrí dos terminales en la carpeta:

```powershell
node server.js
```

```powershell
$env:AGENT_TOKEN = (Get-Content .\config.json -Raw | ConvertFrom-Json).agentToken
npm run demo
```

La demo simula diez PCs y confirma las órdenes sin ejecutar `shutdown.exe`.

## Seguridad y red

- Mantené el servidor en la LAN o VLAN administrativa; no abras el puerto 8787 en el router ni lo publiques en internet.
- Reservá una IP fija o DHCP reservation para el servidor.
- El token de agente permite reportar datos y recibir órdenes para un `pcId`; tratá `config.json` como secreto.
- Si la red incluye usuarios no confiables, colocá el panel detrás de HTTPS mediante un reverse proxy interno o accedé por VPN.
- El servidor solo puede encolar el comando literal `shutdown`; no expone ejecución arbitraria de PowerShell.

## Validación

Ejecutá:

```powershell
npm test
```

La prueba verifica autenticación, rechazo de agentes sin token, telemetría, estado en línea, confirmaciones, entrega y acuse del apagado, y exclusión de equipos protegidos.
