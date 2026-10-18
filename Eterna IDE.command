#!/bin/zsh
project_dir="$(dirname "$0")"
for app_bundle in "$HOME/Applications/Eterna IDE.app" "/Applications/Eterna IDE.app" "$project_dir/src-tauri/target/release/bundle/macos/Eterna IDE.app"; do
  if [ -d "$app_bundle" ]; then
    open "$app_bundle"
    exit 0
  fi
done
echo "Eterna Desktop 앱을 먼저 설치해주세요."
echo "https://github.com/EternaxCode/eterna-ide/releases"
open 'https://github.com/EternaxCode/eterna-ide/releases'
