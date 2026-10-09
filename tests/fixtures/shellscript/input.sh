#!/usr/bin/env bash
set -euo pipefail
readonly TARGET="${1:-build}"
log(){ echo "[$(date +%H:%M:%S)] $*" >&2; }
cleanup(){
rm -rf "$TMP_DIR"
}
TMP_DIR=$(mktemp -d);trap cleanup EXIT
if [ ! -d "$TARGET" ];then
mkdir -p "$TARGET"&&log "created $TARGET"
fi
for file in src/*.txt;do
  case "$file" in
  *.bak) continue;;
  *) cp "$file" "$TARGET/" || log "could not copy $file";;
  esac
done
find "$TARGET" -type f | sort | while read -r f;do wc -l "$f">>"$TMP_DIR/report";done
