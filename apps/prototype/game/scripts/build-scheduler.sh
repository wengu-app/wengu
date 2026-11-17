#!/bin/sh
# Rebuild public/scheduler.js from packages/core's scheduler (run from the repo root).
set -e
ESBUILD=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | head -1)
"$ESBUILD" apps/prototype/game/src/scheduler-entry.ts --bundle --format=iife --global-name=WenguScheduler --minify --target=es2020 \
  --alias:@wengu/anki=./apps/prototype/game/src/anki-shim.ts --alias:sql.js=./apps/prototype/game/src/empty.ts --alias:fflate=./apps/prototype/game/src/empty.ts --alias:fzstd=./apps/prototype/game/src/empty.ts --outfile=apps/prototype/game/public/scheduler.js
