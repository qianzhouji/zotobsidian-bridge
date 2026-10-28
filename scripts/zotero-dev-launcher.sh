#!/bin/bash
set -euo pipefail

: "${BRIDGE_ZOTERO_PROCESS_BIN_PATH:?Set the real Zotero executable path}"

args=()
for arg in "$@"; do
  if [[ "$arg" == "no-remote" ]]; then
    args+=("-no-remote")
    continue
  fi
  args+=("$arg")
done

exec "$BRIDGE_ZOTERO_PROCESS_BIN_PATH" "${args[@]}"
