#!/bin/sh
set -eu
if command -v forge >/dev/null 2>&1 && forge --version 2>/dev/null | grep -q "forge Version"; then
  exec forge "$@"
fi
if [ -x /opt/homebrew/bin/forge ]; then
  exec /opt/homebrew/bin/forge "$@"
fi
echo "Foundry's forge is not on PATH. Install it with: brew install foundry" >&2
exit 1
