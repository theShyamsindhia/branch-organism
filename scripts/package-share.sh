#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$project_dir/package.json').version")"
app_path="$project_dir/work/release/Branch Organism-darwin-universal/Branch Organism.app"
share_dir="$project_dir/work/share"
archive_path="$share_dir/Branch-Organism-$version-mac-universal.zip"
disk_image_path="$share_dir/Branch-Organism-$version-mac-universal.dmg"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/branch-organism-share.XXXXXX")"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

cd "$project_dir"
npm run package:mac:universal

codesign --force --deep --sign - "$app_path"
mkdir -p "$share_dir"
rm -f "$archive_path" "$disk_image_path"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive_path"

mkdir -p "$stage_dir/Branch Organism"
ditto "$app_path" "$stage_dir/Branch Organism/Branch Organism.app"
ln -s /Applications "$stage_dir/Branch Organism/Applications"
hdiutil create \
  -volname "Branch Organism" \
  -srcfolder "$stage_dir/Branch Organism" \
  -ov \
  -format UDZO \
  "$disk_image_path"

echo "$archive_path"
echo "$disk_image_path"
