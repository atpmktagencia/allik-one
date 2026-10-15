#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Use Node.js 22 ou superior."); process.exitCode = 1; }'

# Keep the npm cache in a writable location in restricted cloud environments.
npx --cache "${TMPDIR:-/tmp}/oi-companion-npm-cache" --yes bun@1.3.14 install --frozen-lockfile
echo "Dependências instaladas. Execute npm run cloud:check para verificar o banco."
