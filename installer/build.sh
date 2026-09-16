#!/usr/bin/env bash
# Genera los dos instaladores de Windows (servidor y agente) a partir del código
# fuente. Se puede correr en Linux, macOS o Windows (con NSIS instalado): pkg
# compila un binario win-x64 sin importar el sistema operativo donde se ejecute,
# y makensis solo empaqueta archivos, no necesita Windows para compilar.
#
# El build de pkg usa --no-bytecode --public (ver "build:server-exe" en
# package.json). No los saques: al compilar cross-platform (por ejemplo desde
# Linux hacia win-x64) el cache de bytecode V8 que pkg genera por defecto no es
# compatible con el V8 del binario de Windows y el .exe final revienta al
# arrancar con "V8 rejected the bytecode cache". Confirmado corriendo el .exe
# real bajo Wine.
#
# Requisitos: Node.js 20+, y el compilador de NSIS (makensis) en el PATH.
#   Debian/Ubuntu: sudo apt-get install nsis
#   macOS:         brew install makensis
#   Windows:       https://nsis.sourceforge.io/Download
#
# Uso: ./installer/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v makensis >/dev/null 2>&1; then
  echo "makensis no está en el PATH. Instalá NSIS antes de continuar." >&2
  exit 1
fi

echo "==> Instalando dependencias de build..."
npm install

echo "==> Compilando el servidor a un .exe autocontenido (sin necesidad de Node.js instalado)..."
npm run build:server-exe

echo "==> Empaquetando el instalador del servidor..."
mkdir -p dist/installers
makensis installer/server.nsi

echo "==> Empaquetando el instalador del agente..."
makensis installer/agent.nsi

echo ""
echo "Listo. Instaladores en dist/installers/:"
ls -la dist/installers/
