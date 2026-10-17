#!/usr/bin/env bash
# 汉化流水线的离线仿真：在临时仓库里反复跑「上游更新 → 同步合并 → 机械扫描 →
# 账本排队 → 翻译 → 记账 → 收尾压缩」，逐轮断言下面这些不变量：
#
#   1. 未被上游改动过的文件，合并后仍是中文（上游更新不会把已有翻译整体冲掉）
#   2. 入队文件只包含上游这一轮改过的文件（不会重复翻译已完成的文件）
#   3. 翻译后机械扫描不再命中英文（该轮确实翻干净了）
#   4. 压缩后快照恰好领先上游 1 个提交、落后 0 个（单提交不变量）
#
# 覆盖范围说明：本脚本复刻的是「同步/扫描/记账/压缩」这段数据与 Git 逻辑，
# 不含 Codex 调用、测试步骤与 GHCR 触发；那些靠工作流自身的步骤条件与 CI 结果验证。
#
# 用法：
#   bash .github/scripts/simulate-i18n-pipeline.sh [仓库路径] [轮数]
# 默认仓库路径为当前目录、轮数 100。

set -uo pipefail

SRC="${1:-$(pwd)}"
ROUNDS="${2:-100}"
WORK="$(mktemp -d)"
UP="$WORK/upstream"
FORK="$WORK/fork"

fail=0
declare -a problems=()

problem() {
  problems+=("$1")
  fail=$((fail + 1))
  printf '  !! %s\n' "$1"
}

# ---------- 造一个「上游」仓库：40 个带英文 JSX 文案的文件 ----------
mkdir -p "$UP/src"
cd "$UP" || exit 1
git init -q .
git config user.email upstream@example.com
git config user.name upstream
git symbolic-ref HEAD refs/heads/main
for i in $(seq 1 40); do
  printf 'export function C%s() {\n  return <div>Save changes item %s</div>;\n}\n' "$i" "$i" > "src/f$i.tsx"
done
git add -A
git commit -qm init

# ---------- fork：已全部汉化，并使用仓库里真实的扫描器与账本 ----------
cd "$WORK" || exit 1
git clone -q "$UP" "$FORK"
cd "$FORK" || exit 1
git config user.email fork@example.com
git config user.name fork
mkdir -p .github/scripts
cp "$SRC/.github/scripts/i18n-candidates.sh" "$SRC/.github/scripts/i18n-ledger.mjs" .github/scripts/
for f in src/*.tsx; do
  perl -pi -e 's/>Save changes item ([^<]*)</>保存更改条目 $1</' "$f"
done
git add -A
git commit -qm "translate all"

candidates() { bash .github/scripts/i18n-candidates.sh .; }
candidate_lines() { bash .github/scripts/i18n-candidates.sh --lines .; }
queue_ledger() {
  node .github/scripts/i18n-ledger.mjs queue \
    --candidates "$WORK/cand.txt" --hits "$WORK/lines.txt" --out "$WORK/queue.txt"
}

# 初始记账：全部 clean，模拟「已经翻完并记账」的现状
candidates > "$WORK/cand.txt"
candidate_lines > "$WORK/lines.txt"
cp "$WORK/cand.txt" "$WORK/queue.txt"
if [ -s "$WORK/queue.txt" ]; then
  node .github/scripts/i18n-ledger.mjs record --status clean \
    --files "$WORK/queue.txt" --hits "$WORK/lines.txt" >/dev/null || true
fi
git add -A
git commit -qm "record ledger"

printf '=== 初始：%s 个文件全部汉化并记账 ===\n\n' "$(wc -l < "$WORK/cand.txt" | tr -d ' ')"

for r in $(seq 1 "$ROUNDS"); do
  # ---------- 上游改动：改 2 个文件，每 5 轮加一个新文件，每 7 轮删一个 ----------
  cd "$UP" || exit 1
  changed=()
  for _ in 1 2; do
    n=$(( (RANDOM % 40) + 1 ))
    printf 'export function C%s() {\n  return <div>Save changes item %s rev %s</div>;\n}\n' "$n" "$n" "$r" > "src/f$n.tsx"
    changed+=("src/f$n.tsx")
  done
  if [ $(( r % 5 )) -eq 0 ]; then
    printf 'export function New%s() {\n  return <div>Save changes brand new %s</div>;\n}\n' "$r" "$r" > "src/new$r.tsx"
    changed+=("src/new$r.tsx")
  fi
  if [ $(( r % 7 )) -eq 0 ]; then
    d=$(( (RANDOM % 40) + 1 ))
    git rm -q --ignore-unmatch "src/f$d.tsx"
    changed+=("src/f$d.tsx")
  fi
  git add -A
  git commit -qm "upstream round $r"

  # ---------- fork 同步：与 localize-zh.yml「同步上游代码」同一套逻辑 ----------
  cd "$FORK" || exit 1
  git remote remove upstream >/dev/null 2>&1 || true
  git remote add upstream "$UP"
  git fetch --no-tags upstream main >/dev/null 2>&1
  base="$(git merge-base HEAD FETCH_HEAD)"
  git diff -z --diff-filter=D --name-only "$base" FETCH_HEAD > "$WORK/deleted.txt"
  if [ -s "$WORK/deleted.txt" ]; then
    while IFS= read -r -d '' f; do
      git rm -q -f --ignore-unmatch -- "$f" >/dev/null 2>&1 || rm -f -- "$f"
    done < "$WORK/deleted.txt"
    git commit -qm "drop upstream-deleted"
  fi
  if ! git merge --no-edit -X theirs FETCH_HEAD >/dev/null 2>&1; then
    git diff -z --name-only --diff-filter=U > "$WORK/unresolved.txt"
    while IFS= read -r -d '' p; do
      if git cat-file -e "FETCH_HEAD:$p" 2>/dev/null; then
        git checkout FETCH_HEAD -- "$p"
      else
        git rm -q -f --ignore-unmatch -- "$p" >/dev/null 2>&1 || rm -f -- "$p"
      fi
      git add -A -- "$p"
    done < "$WORK/unresolved.txt"
    git commit -q --no-edit
  fi

  # 不变量 1：未被上游碰过的文件必须还是中文
  lost=0
  for f in src/*.tsx; do
    case " ${changed[*]} " in
      *" $f "*) continue ;;
    esac
    if grep -q "Save changes" "$f" 2>/dev/null; then
      lost=$((lost + 1))
    fi
  done
  [ "$lost" -eq 0 ] || problem "第 $r 轮：合并后 $lost 个未被上游改动过的文件退回了英文"

  # ---------- 扫描 + 账本排队 ----------
  candidates > "$WORK/cand.txt"
  candidate_lines > "$WORK/lines.txt"
  queue_ledger > "$WORK/stats.json" 2>/dev/null
  queued=$(wc -l < "$WORK/queue.txt" | tr -d ' ')

  # 不变量 2：队列里不应出现未被上游改动的文件
  extra=0
  while IFS= read -r q; do
    [ -n "$q" ] || continue
    case " ${changed[*]} " in
      *" $q "*) ;;
      *) extra=$((extra + 1)) ;;
    esac
  done < "$WORK/queue.txt"
  [ "$extra" -eq 0 ] || problem "第 $r 轮：队列里有 $extra 个未被上游改动的文件（重复翻译）"

  # ---------- 翻译并记账 ----------
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    perl -pi -e 's/>Save changes ([^<]*)</>保存更改 $1</' "$f" 2>/dev/null || true
  done < "$WORK/queue.txt"
  if [ -s "$WORK/queue.txt" ]; then
    node .github/scripts/i18n-ledger.mjs record --status clean \
      --files "$WORK/queue.txt" --hits "$WORK/lines.txt" >/dev/null || true
  fi
  git add -A
  git diff --cached --quiet || git commit -qm "translate round $r"

  # 不变量 3：翻译后不应再有英文候选（对应工作流的 remaining=0 → 收尾打镜像）
  left=$(candidates | wc -l | tr -d ' ')
  [ "$left" -eq 0 ] || problem "第 $r 轮：翻译后仍有 $left 个文件命中英文扫描"

  # ---------- 收尾压缩：与「压缩为单个提交并强推」同一套逻辑 ----------
  git fetch --no-tags upstream main >/dev/null 2>&1
  tip="$(git rev-parse FETCH_HEAD)"
  git add -A
  tree="$(git write-tree)"
  sq="$(git commit-tree "$tree" -p "$tip" -m "snapshot round $r")"
  git update-ref refs/heads/main "$sq"

  # 不变量 4：快照恰好领先上游 1 个提交、落后 0 个
  ahead=$(git rev-list --count "$tip"..main)
  behind=$(git rev-list --count main.."$tip")
  [ "$ahead" = "1" ] || problem "第 $r 轮：快照不是领先上游 1 个提交（ahead=$ahead）"
  [ "$behind" = "0" ] || problem "第 $r 轮：落后上游 $behind 个提交"

  total=$(find src -name '*.tsx' | wc -l | tr -d ' ')
  printf '轮 %3s: 上游改动 %s | 入队 %s | 译文丢失 %s | 文件 %s | ahead=%s behind=%s\n' \
    "$r" "${#changed[@]}" "$queued" "$lost" "$total" "$ahead" "$behind"
done

printf '\n==============================================\n'
printf '轮数：%s    问题数：%s\n' "$ROUNDS" "$fail"
if [ "$fail" -gt 0 ]; then
  printf ' - %s\n' "${problems[@]}" | head -20
  exit 1
fi
printf '四项不变量全部成立：无翻译丢失、无重复翻译、无残留英文、单提交快照稳定。\n'
