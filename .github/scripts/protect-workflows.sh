#!/usr/bin/env bash
set -euo pipefail

# The default GITHUB_TOKEN cannot push changes to .github/workflows/**.
# Codex runs are allowed to inspect the repository, so any workflow edits they
# leave behind must be discarded before the next commit or force-push.
source_ref="${1:-${WORKFLOW_PROTECT_REF:-HEAD}}"
workflow_dir=".github/workflows"

if ! git cat-file -e "${source_ref}:${workflow_dir}" 2>/dev/null; then
  exit 0
fi

changes="$(git status --porcelain=v1 -- "$workflow_dir" || true)"
if [ -z "$changes" ]; then
  exit 0
fi

echo "::warning title=工作流文件改动已还原::机器人无权更新 ${workflow_dir}，以下改动已按 ${source_ref} 还原："
printf '%s\n' "$changes"

git rm -r -q --ignore-unmatch -- "$workflow_dir" >/dev/null 2>&1 || true
git checkout "$source_ref" -- "$workflow_dir"

git ls-files --others --exclude-standard -z -- "$workflow_dir" |
  while IFS= read -r -d '' path; do
    rm -f -- "$path"
  done
