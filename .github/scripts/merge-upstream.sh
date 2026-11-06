#!/usr/bin/env bash
# 将上游引用同步到当前分支：对上游改动过的路径采用上游版本，未改动路径保留本地汉化。
#
# 用法：
#   bash .github/scripts/merge-upstream.sh [上游引用]
#
# 默认使用 FETCH_HEAD。脚本只操作当前仓库，不负责 fetch 或推送。
# 上游工作流文件会在提交前按 WORKFLOW_PROTECT_REF（默认 HEAD）还原，
# 因为默认 GITHUB_TOKEN 无权推送 .github/workflows/**。

set -euo pipefail

upstream_ref="${1:-FETCH_HEAD}"

if ! git rev-parse --verify "${upstream_ref}^{commit}" >/dev/null 2>&1; then
  echo "::error title=上游同步失败::找不到上游引用 ${upstream_ref}。" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

if [ -n "${RUNNER_TEMP:-}" ]; then
  tmp_dir="$(mktemp -d "$RUNNER_TEMP/i18n-sync.XXXXXX")"
else
  tmp_dir="$(mktemp -d)"
fi
changed_list="$tmp_dir/upstream-changed.txt"
local_gitlinks="$tmp_dir/local-gitlinks.txt"
upstream_gitlinks="$tmp_dir/upstream-gitlinks.txt"
: > "$local_gitlinks"
: > "$upstream_gitlinks"

base="$(git merge-base HEAD "$upstream_ref")"
git diff -z --name-only --no-renames "$base" "$upstream_ref" > "$changed_list"

collect_gitlinks() {
  local output="$1"
  local entry path
  shift
  "$@" | while IFS= read -r -d '' entry; do
    case "$entry" in
      160000\ *)
        path="${entry#*$'\t'}"
        [ "$path" != "$entry" ] && printf '%s\0' "$path"
        ;;
    esac
  done >> "$output"
}

remove_path() {
  local path="$1"

  # git rm 会同时清理索引和工作树；成功时删除已经暂存，不能再对
  # 已不存在的路径执行 git add，否则会报 pathspec did not match。
  if git --literal-pathspecs rm -r -q -f --ignore-unmatch -- "$path" >/dev/null 2>&1; then
    return 0
  fi

  # 未检出的 gitlink 可能无法通过 git rm 清理，但仍可以从索引中直接移除。
  git update-index --force-remove -- "$path" >/dev/null 2>&1 || true
  rm -f -- "$path"
  git --literal-pathspecs add -u -- "$path" >/dev/null 2>&1 || true
}

is_beneath_upstream_gitlink() {
  local path="$1"
  local entry metadata mode

  # git diff 可能同时列出 gitlink 父路径和它下面的旧文件路径。
  # 父路径先写入索引后，再处理子路径会把父 gitlink 删除，因此这里统一跳过
  # 上游 gitlink 内部的派生路径；父路径本身仍会正常更新。
  while [[ "$path" == */* ]]; do
    path="${path%/*}"
    entry="$(git ls-tree -z "$upstream_ref" -- ":(literal)${path}")"
    if [ -n "$entry" ]; then
      metadata="$(printf '%s' "$entry" | cut -f1)"
      mode="$(printf '%s\n' "$metadata" | awk '{print $1}')"
    else
      # 上游删除 gitlink 时，diff 只会列出它下面的旧文件；当前索引仍是 gitlink。
      # 这时也必须跳过子路径，交给后面的本地 gitlink 清理逻辑处理父路径。
      entry="$(git ls-files --stage -- ":(literal)${path}")"
      metadata="$(printf '%s' "$entry" | cut -f1)"
      mode="$(printf '%s\n' "$metadata" | awk '{print $1}')"
    fi
    if [ "$mode" = "160000" ]; then
      return 0
    fi
  done
  return 1
}

apply_upstream_path() {
  local path="$1"
  local literal=":(literal)${path}"
  local entry metadata mode sha

  if is_beneath_upstream_gitlink "$path"; then
    echo "跳过上游 gitlink 内部路径：${path}"
    return
  fi

  entry="$(git ls-tree -z "$upstream_ref" -- "$literal")"
  if [ -z "$entry" ]; then
    echo "上游已删除，移除本地版本：${path}"
    remove_path "$path"
    return
  fi

  # ls-tree -z 的输出是“mode type sha<TAB>path<NUL>”，只取制表符前的元数据。
  metadata="$(printf '%s' "$entry" | cut -f1)"
  mode="$(printf '%s\n' "$metadata" | awk '{print $1}')"
  sha="$(printf '%s\n' "$metadata" | awk '{print $3}')"

  if [ "$mode" = "160000" ]; then
    # gitlink 指向的提交不一定在父仓库对象库中，不能 checkout；直接写入索引指针。
    # 先清掉当前文件或旧 gitlink，避免工作树残留阻止后续 status 收敛。
    git --literal-pathspecs rm -r -q -f --ignore-unmatch -- "$path" >/dev/null 2>&1 || true
    git update-index --add --cacheinfo "${mode},${sha},${path}"
    # gitlink 没有检出子模块时，工作树中保留空目录即可让 status 收敛。
    mkdir -p -- "$path"
    echo "采用上游 gitlink：${path} -> ${sha:0:9}"
    return
  fi

  # 上游改过的普通文件/符号链接直接整文件覆盖，避免 -X theirs 只解决文本冲突、
  # 却把上游新增的 import、hook 或类型结构留在旧版本。
  git restore --source="$upstream_ref" --staged --worktree -- "$literal"
  echo "采用上游版本：${path}"
}

if [ -s "$changed_list" ]; then
  while IFS= read -r -d '' path; do
    [ -n "$path" ] || continue
    apply_upstream_path "$path"
  done < "$changed_list"
fi

# 上游可能新增/删除/更新 gitlink，而这些路径不一定完整出现在
# `git diff --name-only` 中（例如父路径从普通目录变成 gitlink 时只列出子文件）。
# 单独按索引、HEAD 和上游树收集 gitlink，保证指针始终跟随上游；上游已删除的
# 本地 gitlink 则必须从索引移除，否则后续提交仍会带上旧指针。
collect_gitlinks "$local_gitlinks" git ls-files --stage -z
collect_gitlinks "$local_gitlinks" git ls-tree -r -z --full-tree HEAD
collect_gitlinks "$upstream_gitlinks" git ls-tree -r -z --full-tree "$upstream_ref"

while IFS= read -r -d '' path; do
  [ -n "$path" ] || continue
  if [ -n "$(git ls-tree -z "$upstream_ref" -- ":(literal)${path}")" ]; then
    apply_upstream_path "$path"
  else
    echo "上游已删除本地 gitlink，移除指针：${path}"
    remove_path "$path"
  fi
done < "$local_gitlinks"

while IFS= read -r -d '' path; do
  [ -n "$path" ] || continue
  apply_upstream_path "$path"
done < "$upstream_gitlinks"

# 上游可能修改/删除工作流文件；默认 GITHUB_TOKEN 无权推送这些路径。
# 在同步提交前恢复为本仓库受保护版本，避免后续批次推送被 GitHub 拒绝。
if [ -f .github/scripts/protect-workflows.sh ]; then
  bash .github/scripts/protect-workflows.sh "${WORKFLOW_PROTECT_REF:-HEAD}"
fi

if ! git diff --cached --quiet; then
  git commit -qm "chore(i18n): 同步上游代码"
  git --no-pager log --oneline -1
else
  echo "上游没有需要写入本地的路径。"
fi
