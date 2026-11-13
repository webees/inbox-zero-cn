#!/usr/bin/env bash
# 推送被拒绝时合并远端分支，避免 `git pull --rebase` 在未检出的 gitlink 上失败。
#
# 用法：
#   bash .github/scripts/merge-remote.sh <分支名>
#
# 普通文件冲突优先保留本地批次改动；gitlink 冲突优先采用远端指针，
# 因为远端通常已经包含最新的上游同步结果。

set -euo pipefail

branch="${1:?用法: merge-remote.sh <分支名>}"

cd "$(git rev-parse --show-toplevel)"

git fetch --no-tags origin "$branch"
remote_tip="$(git rev-parse FETCH_HEAD)"

if git merge-base --is-ancestor "$remote_tip" HEAD; then
  echo "远端已包含在当前分支中。"
  exit 0
fi

if git merge-base --is-ancestor HEAD "$remote_tip"; then
  git merge --ff-only "$remote_tip"
  exit 0
fi

# -X ours 只处理普通文本冲突；子模块冲突仍需在下面显式收敛。
if ! git merge --no-commit --no-ff -X ours "$remote_tip"; then
  :
fi

if [ -n "${RUNNER_TEMP:-}" ]; then
  tmp_dir="$(mktemp -d "$RUNNER_TEMP/i18n-remote.XXXXXX")"
else
  tmp_dir="$(mktemp -d)"
fi
unmerged="$tmp_dir/unmerged.txt"
git diff -z --name-only --diff-filter=U > "$unmerged"

while IFS= read -r -d '' path; do
  [ -n "$path" ] || continue
  literal=":(literal)${path}"
  ours_line="$(git --literal-pathspecs ls-files --stage -- "$path" | awk '$3 == 2 {print; exit}')"
  theirs_line="$(git --literal-pathspecs ls-files --stage -- "$path" | awk '$3 == 3 {print; exit}')"
  ours_mode="$(printf '%s\n' "$ours_line" | awk '{print $1}')"
  ours_sha="$(printf '%s\n' "$ours_line" | awk '{print $2}')"
  theirs_mode="$(printf '%s\n' "$theirs_line" | awk '{print $1}')"
  theirs_sha="$(printf '%s\n' "$theirs_line" | awk '{print $2}')"

  if [ "$theirs_mode" = "160000" ] || [ "$ours_mode" = "160000" ]; then
    if [ -n "$theirs_sha" ]; then
      git update-index --force-remove -- "$path" 2>/dev/null || true
      git update-index --add --cacheinfo "160000,${theirs_sha},${path}"
      mkdir -p -- "$path"
      echo "gitlink 冲突采用远端指针：${path} -> ${theirs_sha:0:9}"
    elif [ -n "$ours_sha" ]; then
      git update-index --force-remove -- "$path" 2>/dev/null || true
      git update-index --add --cacheinfo "160000,${ours_sha},${path}"
      mkdir -p -- "$path"
      echo "gitlink 冲突采用本地指针：${path} -> ${ours_sha:0:9}"
    else
      git update-index --force-remove -- "$path" 2>/dev/null || true
      echo "gitlink 冲突按删除处理：${path}"
    fi
    continue
  fi

  if [ -n "$ours_sha" ]; then
    git checkout --ours -- "$literal"
    git add -- "$literal"
    echo "文本冲突保留本地版本：${path}"
  else
    git --literal-pathspecs rm -r -q -f --ignore-unmatch -- "$path" >/dev/null 2>&1 || true
    git update-index --force-remove -- "$path" 2>/dev/null || true
    echo "文本冲突按本地删除处理：${path}"
  fi
done < "$unmerged"

if [ -s "$unmerged" ] && [ -n "$(git diff --name-only --diff-filter=U)" ]; then
  git merge --abort >/dev/null 2>&1 || true
  echo "::error title=远端合并失败::仍有未解决冲突，已中止本次合并。" >&2
  exit 1
fi

# 机器人不能推送工作流改动；合并后恢复本地受保护版本。
if [ -f .github/scripts/protect-workflows.sh ]; then
  bash .github/scripts/protect-workflows.sh HEAD
fi
bash .github/scripts/stage-worktree.sh

if [ -f "$(git rev-parse --git-path MERGE_HEAD)" ]; then
  git commit -qm "chore(i18n): 合并远端并发更新"
  echo "已合并远端 ${remote_tip:0:9} 并提交。"
else
  echo "远端没有需要合并的改动。"
fi
