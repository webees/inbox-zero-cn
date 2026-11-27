#!/usr/bin/env bash
# 中文对象键在测试里常被写成 obj["键"]，但 Biome 的 useLiteralKeys
# 只提供 unsafe fix。统一在格式校验和提交前处理，避免 pre-commit 阻断流水线。

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pnpm exec biome check --write --unsafe --files-ignore-unknown=true \
  --only=lint/complexity/useLiteralKeys .
