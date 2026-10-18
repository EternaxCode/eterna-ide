#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Node.js 24 이상을 설치해주세요."
  read -k 1
  exit 1
fi
if [ ! -d node_modules ]; then
  npm ci || exit 1
fi
node scripts/launch.mjs
