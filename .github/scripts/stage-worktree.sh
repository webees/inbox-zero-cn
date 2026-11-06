#!/usr/bin/env bash
# 暂存工作树改动，但排除所有 gitlink（子模块）路径。
#
# 本仓库的营销目录以 160000 gitlink 形式存在，却没有可检出的子模块；
# 直接 git add -A 会报 "does not have a commit checked out"。gitlink 指针的
# 更新/删除由 merge-upstream.sh 直接写索引处理，本脚本只负责普通文件。

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ -n "${RUNNER_TEMP:-}" ]; then
  tmp_dir="$(mktemp -d "$RUNNER_TEMP/i18n-stage.XXXXXX")"
else
  tmp_dir="$(mktemp -d)"
fi
gitlinks="$tmp_dir/gitlinks.txt"

# 同时收集索引和 HEAD 中的 gitlink：上游删除 gitlink 后，索引里可能已经没有
# 该路径，但工作树里的旧目录仍可能被 `git add -A` 扫到。
{
  git ls-files --stage -z
  git ls-tree -r -z --full-tree HEAD 2>/dev/null || true
} | while IFS= read -r -d '' entry; do
  case "$entry" in
    160000\ *)
      path="${entry#*$'\t'}"
      [ "$path" != "$entry" ] && printf '%s\0' "$path"
      ;;
  esac
done > "$gitlinks"

args=(add -A -- .)
while IFS= read -r -d '' path; do
  [ -n "$path" ] || continue
  args+=(":(exclude,literal)${path}")
done < "$gitlinks"

git "${args[@]}"
