#!/bin/sh
# Electron tests need a display on Linux; use xvfb-run when available.
if [ "$(uname)" = "Linux" ] && [ -z "$DISPLAY" ] && command -v xvfb-run >/dev/null; then
  exec xvfb-run -a npx playwright test --project=electron "$@"
fi
exec npx playwright test --project=electron "$@"
