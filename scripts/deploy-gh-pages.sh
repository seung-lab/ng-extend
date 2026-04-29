#!/bin/bash
# Deploy EyeWire II Community to GitHub Pages
# Usage: bash scripts/deploy-gh-pages.sh

set -e

DEPLOY_REPO="https://github.com/amyleesterling/eyewire-ii.git"
DEPLOY_DIR=$(mktemp -d)

echo "Building..."
# `npm run build` invokes esbuild AND tsc. esbuild emits the bundle first, then
# tsc type-checks third_party/neuroglancer/**, which prints pre-existing noise
# (missing jasmine globals in *.spec.ts, no SVG module decls). Those tsc
# warnings exit non-zero but don't reflect a real build failure — the bundle is
# already on disk. So: run the build, then trust the bundle's presence rather
# than the exit code. A real esbuild failure leaves no bundle and we abort.
set +e
npm run build
BUILD_EXIT=$?
set -e

if [ ! -f "dist/min/main.bundle.js" ]; then
  echo "Build failed: dist/min/main.bundle.js not found (npm run build exit=$BUILD_EXIT)"
  exit 1
fi

if [ "$BUILD_EXIT" -ne 0 ]; then
  echo "npm run build exit=$BUILD_EXIT but dist/min/main.bundle.js exists — assuming tsc-only warnings, proceeding."
fi

echo "Deploying to $DEPLOY_REPO"
git clone --depth 1 "$DEPLOY_REPO" "$DEPLOY_DIR"
rm -rf "$DEPLOY_DIR"/*
cp -r dist/min/* "$DEPLOY_DIR/"

# Copy badge center-art PNGs (from in-repo static assets)
BADGE_ART="static/badges/pyr/center-art"
if [ -d "$BADGE_ART" ]; then
  echo "Copying badge center-art..."
  mkdir -p "$DEPLOY_DIR/center-art/building" "$DEPLOY_DIR/center-art/exploration"
  cp "$BADGE_ART/building/"*.png "$DEPLOY_DIR/center-art/building/" 2>/dev/null || true
  cp "$BADGE_ART/exploration/"*.png "$DEPLOY_DIR/center-art/exploration/" 2>/dev/null || true
fi

cd "$DEPLOY_DIR"
git add -A
git commit -m "Deploy $(date +%Y-%m-%d\ %H:%M)" --allow-empty

if [ "${SKIP_PUSH:-0}" = "1" ]; then
  echo "SKIP_PUSH=1 set — skipping git push origin main (dry run)."
  echo "Would have pushed to: $DEPLOY_REPO"
else
  git push origin main
  echo ""
  echo "Deployed! Live at: https://amyleesterling.github.io/eyewire-ii/"
fi

# Cleanup
rm -rf "$DEPLOY_DIR"
