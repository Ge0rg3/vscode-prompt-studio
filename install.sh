#!/usr/bin/env bash
# Packages the extension and installs it into VSCode
set -euo pipefail

cd "$(dirname "$0")"

CODE_COMMAND="${CODE_CLI:-code}"

# Check the VSCode CLI is reachable before spending time on a build
if ! command -v "$CODE_COMMAND" > /dev/null 2>&1; then
  echo "install.sh: '$CODE_COMMAND' not found on PATH, set CODE_CLI to your VSCode CLI" >&2
  exit 1
fi

# Install dependencies on a fresh checkout
if [ ! -d node_modules ]; then
  npm install
fi

# Package the extension, the production build runs through vscode:prepublish.
# Pipefail comes off because yes dies on the closed pipe once npm has finished
set +o pipefail
yes | npm run vsix
set -o pipefail

# Reinstall over the same version
VSIX="$(node -p "const manifest = require('./package.json'); \`\${manifest.name}-\${manifest.version}.vsix\`")"
"$CODE_COMMAND" --install-extension "$VSIX" --force

echo
echo "Installed $VSIX. Reload VSCode to pick it up."
