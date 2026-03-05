#!/bin/bash
# Deploy EyeWire II Community to GitHub Pages
# Usage: bash scripts/deploy-gh-pages.sh

set -e

DEPLOY_REPO="https://github.com/amyleesterling/eyewire-ii.git"
DEPLOY_DIR=$(mktemp -d)

echo "Building..."
npm run build

echo "Deploying to $DEPLOY_REPO"
git clone --depth 1 "$DEPLOY_REPO" "$DEPLOY_DIR"
rm -rf "$DEPLOY_DIR"/*
cp -r dist/min/* "$DEPLOY_DIR/"

cd "$DEPLOY_DIR"
git add -A
git commit -m "Deploy $(date +%Y-%m-%d\ %H:%M)" --allow-empty
git push origin main

echo ""
echo "Deployed! Live at: https://amyleesterling.github.io/eyewire-ii/"

# Cleanup
rm -rf "$DEPLOY_DIR"
