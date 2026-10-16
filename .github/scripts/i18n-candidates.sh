#!/usr/bin/env bash
# 扫描"疑似仍含英文文案"的位置。
#
# 用法：
#   bash .github/scripts/i18n-candidates.sh <path> [额外 rg -g 规则...]
#       → 每个文件一行（仓库相对路径），用于分批
#   bash .github/scripts/i18n-candidates.sh --lines <path> [额外 rg -g 规则...]
#       → 每处命中一行（path:line），用于告诉模型只读必要区域，避免整文件通读
#
# 只做高信号启发式扫描：JSX 文本、常见用户可见属性、以及多词英文常量。
# 已经是中文的文件不会命中，因此重复运行时只会挑出真正还需要汉化的位置。
set -uo pipefail

mode="files"
if [ "${1:-}" = "--lines" ]; then
  mode="lines"
  shift
fi

path="${1:?用法: i18n-candidates.sh [--lines] <path>}"
shift

rg_args=(
  -g '*.ts' -g '*.tsx' -g '*.md' -g '*.mdx'
  -g '!**/*.test.*' -g '!**/__tests__/**' -g '!**/__snapshots__/**'
  # 汉化工具自身（提示词/工作流/脚本）不是产品文案，扫进来只会自我翻译
  -g '!.github/**'
  # Playwright 相关脚本面向开发者、对应工作流已停用；翻译它们只会破坏断言并制造同步噪声
  -g '!apps/web/scripts/playwright-*'
  # 测试夹具是测试数据（邮件草稿/签名样本等），翻译它们只会让断言失效
  -g '!**/fixtures/**'
  -g '!**/__fixtures__/**'
)
for glob in "$@"; do
  rg_args+=(-g "$glob")
done
rg_args+=(
  # JSX 文本（紧跟标签）
  -e '>\s*[A-Z][a-z]+\s+[a-z]+'
  # JSX 属性里的文案
  -e '(?:placeholder|aria-label|title|description|label|name|message|text)="[A-Z][A-Za-z][^"]{3,}"'
  # 多词英文常量
  -e ': "(?:[A-Z][a-z]+\s+){2,}[A-Za-z][^"]*"'
  # 对象属性里的 UI 文案（含单词），例如 label: "Rules" / title: "Settings"
  -e '(?:label|name|title|description|message|text|placeholder|ariaLabel)\s*:\s*"[A-Z][A-Za-z][^"]{1,}"'
  # 单独成行的 JSX 文本（子元素之后紧跟的文案也算），例如 Watch demo / Categorize
  -e '^\s*[A-Z][A-Za-z]+(?:\s+[a-z][A-Za-z]*)*[.!?]?\s*$'
  # 带内插的模板文案，例如 `${count} senders`
  -e '\$\{[^}]+\}\s+[a-z][A-Za-z]+'
)

if [ "$mode" = "lines" ]; then
  # rg -n 输出 path:line:内容，这里只保留 path:line
  rg -n --pcre2 "${rg_args[@]}" "$path" 2>/dev/null \
    | sed -nE 's#^([^:]+):([0-9]+):.*#\1:\2#p' \
    | rg -v 'Inbox Zero|Gmail|Google|Outlook|Microsoft|Slack|Telegram|Stripe|OpenAI|Anthropic|Vercel' \
    | rg -v 'utils/rule/consts\.ts|utils/categories\.ts|split-inbox/split-library\.ts|category-config\.tsx' \
    | sort -u || true
else
  rg -l --pcre2 "${rg_args[@]}" "$path" 2>/dev/null \
    | rg -v 'Inbox Zero|Gmail|Google|Outlook|Microsoft|Slack|Telegram|Stripe|OpenAI|Anthropic|Vercel' \
    | rg -v 'utils/rule/consts\.ts|utils/categories\.ts|split-inbox/split-library\.ts|category-config\.tsx' \
    | sort || true
fi
