# Manejo de PC's Inercia

Dashboard local y liviano para monitorear las PCs de Simuladores Inercia y apagarlas de forma individual o conjunta.

## Arquitectura

- **Servidor:** Node.js 20, sin paquetes externos ni base de datos. Mantiene el estado actual en memoria y un registro pequeño en `.data/events.jsonl`. Se distribuye como un `.exe` autocontenido (Node.js incluido adentro) instalado como tarea de inicio automático de Windows, así que no requiere instalar nada aparte ni depende de que quede una ventana abierta.
- **Agente:** PowerShell en cada PC Windows (viene incluido en Windows, no hay nada que instalar). Envía telemetría por HTTP saliente y consulta únicamente comandos permitidos.
- **Interfaz:** HTML, CSS y JavaScript nativos con actualizaciones en vivo por Server-Sent Events.
- **Acceso:** un único PIN de administración. Es la contraseña del panel **y** la credencial que usan los agentes para reportarse — no hay tokens separados que generar, copiar a cada PC ni que se desincronicen si el servidor se reinicia.

El servidor ejecuta un solo proceso y no necesita una base de datos, framework web ni procesos auxiliares.

## Instalación (recomendada): instaladores gráficos

Ya no hace falta usar la consola ni copiar tokens a mano. Hay dos instaladores `.exe`:

- **`InerciaFleetServer-Setup.exe`** — se instala una sola vez, en la PC que va a ser el servidor.
- **`InerciaFleetAgent-Setup.exe`** — se instala en cada PC de simulador que se quiera monitorear/apagar.

### 1. Servidor

1. Copiá `InerciaFleetServer-Setup.exe` a la PC que va a actuar como servidor y ejecutalo como administrador.
2. El asistente pide el **puerto** (por defecto `8787`, no hace falta tocarlo) y un **PIN de administración** (mínimo 6 caracteres).
3. El instalador configura todo solo: registra el inicio automático con Windows (arranca con la PC, sin sesión abierta, y se reinicia solo si se cae), abre el puerto en el Firewall de Windows solo para la red local, y al terminar puede abrir el panel directamente en el navegador.
4. Anotá la **dirección del servidor** que muestra el asistente (por ejemplo `http://192.168.20.10:8787`) y el **PIN**: son los dos únicos datos que se necesitan para instalar los agentes.

### 2. Cada PC de simulador (agente)

1. Copiá `InerciaFleetAgent-Setup.exe` a la PC del simulador y ejecutalo como administrador.
2. El asistente pide la **dirección del servidor** y el **mismo PIN** configurado en el paso anterior. El nombre de la estación se completa solo con el nombre de la PC de Windows (se puede cambiar ahí mismo si se prefiere algo como "Simulador 05").
3. El instalador prueba la conexión contra el servidor antes de terminar y registra el agente para que arranque con Windows.
4. La estación aparece en el panel en menos de 15 segundos.

Repetí el paso 2 en cada una de las PCs de la flota (`sim-01` a `sim-10`, etc.).

### Instalación desatendida (varias PCs a la vez)

Para no pasar por el asistente gráfico en cada máquina, ambos instaladores aceptan parámetros por línea de comandos con `/S` (instalación silenciosa):

```powershell
InerciaFleetServer-Setup.exe /S /PIN=tu-pin /PORT=8787
InerciaFleetAgent-Setup.exe /S /SERVERURL=http://192.168.20.10:8787 /PIN=tu-pin /NAME=Simulador-05
```

Esto sirve para desplegar la flota con un script de inicio de sesión, PsExec o cualquier herramienta de gestión remota.

### Desinstalar

Desde "Agregar o quitar programas" de Windows: **Inercia Fleet Server** o **Inercia Fleet Agent**. El desinstalador saca la tarea de inicio automático y la regla de Firewall; el `config.json` del servidor (con el PIN) se conserva por si es una reinstalación.

## Uso diario

Abrí la dirección del servidor desde una PC de administración, ingresá el PIN y revisá las estaciones. Una estación pasa a **Offline** si no reporta durante 25 segundos.

- **Apagar una PC:** botón `Apagar` en su tarjeta y segunda confirmación en el modal.
- **Apagar todas:** botón superior `Apagar PCs`; se debe escribir `APAGAR TODO`.
- Las PCs con `"protected": true` nunca reciben una orden desde el apagado general.
- Windows muestra un aviso de 20 segundos antes de apagar. En ese intervalo se puede cancelar localmente con `shutdown /a`.

## Seguridad y red

- Mantené el servidor en la LAN o VLAN administrativa; no abras el puerto 8787 en el router ni lo publiques en internet.
- Reservá una IP fija o DHCP reservation para el servidor.
- El PIN es la única credencial de todo el sistema: la usa el panel de administración **y** cada agente. Tratalo como una contraseña compartida — quien la tenga puede ver el estado de la flota, apagar PCs y reportarse como agente. Si se filtra, cambiala desde una reinstalación del servidor (o editando `config.json` y reiniciando la tarea **Inercia Fleet Server**) y reinstalá los agentes con el PIN nuevo.
- Los intentos fallidos de PIN (tanto en el login del panel como en el check-in de un agente) comparten el mismo límite: 5 intentos fallidos bloquean esa IP por 60 segundos.
- Si la red incluye usuarios no confiables, colocá el panel detrás de HTTPS mediante un reverse proxy interno o accedé por VPN.
- El servidor solo puede encolar el comando literal `shutdown`; no expone ejecución arbitraria de PowerShell.

## Próximo paso: Wake-on-LAN

Está planeado agregar la posibilidad de **prender** las PCs de simulador por Wake-on-LAN desde el panel, además de apagarlas. Todavía no está implementado: falta definir cómo se captura la MAC de cada PC y cómo se envía el paquete mágico dentro de la red del cliente (subred, switches administrados, etc. varían de instalación a instalación). Se va a resolver en una etapa posterior, sin tocar el flujo de instalación actual.

## Para desarrolladores: compilar los instaladores desde el código fuente

Los instaladores no se versionan en el repositorio (pesan decenas de MB); se generan con:

```bash
./installer/build.sh
```

Esto compila el servidor a `dist/server/InerciaFleetServer.exe` con [`pkg`](https://github.com/yao-pkg/pkg) (Node.js 22 embebido, no hace falta instalarlo en la PC destino) y empaqueta ambos instaladores con [NSIS](https://nsis.sourceforge.io/) en `dist/installers/`. Requiere Node.js 20+ y `makensis` en el `PATH` (en Debian/Ubuntu: `sudo apt-get install nsis`). Funciona igual en Linux, macOS o Windows: la compilación cruzada a Windows no depende del sistema operativo donde se corra.

### Correr el servidor desde el código fuente (sin instalador)

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-server.ps1
```

Hace lo mismo que el instalador gráfico (pide el PIN, configura el Firewall y el inicio automático) pero usando `node.exe` en vez del `.exe` empaquetado — útil para desarrollo. Para instalar un agente manualmente de la misma forma: `.\scripts\install-agent.ps1 -ServerUrl "http://IP:8787" -Pin "tu-pin"`.

### Probar sin apagar equipos

Después de configurar el servidor, abrí dos terminales en la carpeta:

```powershell
node server.js
```

```powershell
$env:ADMIN_PIN = (Get-Content .\config.json -Raw | ConvertFrom-Json).adminPin
npm run demo
```

La demo simula diez PCs y confirma las órdenes sin ejecutar `shutdown.exe`.

### Validación

Ejecutá:

```powershell
npm test
```

La prueba verifica autenticación, rechazo de agentes sin PIN válido, telemetría, estado en línea, confirmaciones, entrega y acuse del apagado, y exclusión de equipos protegidos.
