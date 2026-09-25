#!/usr/bin/env bash
# 固定验收入口：notifybus 的 10 个场景（format 3 + evidence 3 + coverage 2 + integrity 2）。
# 用法：bash scripts/check.sh [-list] [--only <组名>]
set -uo pipefail

cd "$(dirname "$0")/.."

NODE="${NODE:-}"
if [ -z "$NODE" ]; then
  for candidate in node nodejs; do
    if command -v "$candidate" >/dev/null 2>&1; then
      NODE="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE" ]; then
  echo "找不到 Node.js 解释器（node / nodejs）" >&2
  exit 2
fi

exec "$NODE" check/check.mjs "$@"
