# Codex 汉化任务

`localize-zh.prompt.md` 是交给 Codex CLI 执行的汉化任务说明，由 `.github/workflows/localize-zh.yml` 在每次运行时读取。

## 触发条件

工作流每 6 小时运行一次（UTC 0/6/12/18 点），但只有**上游有新提交**时才会继续：同步步骤先 `git fetch` 上游，比较 `HEAD..upstream/main` 的提交数，为 0 就直接结束，不启动 Codex、也不产生提交。手动触发时可勾选 `force_run` 强制跑一次。

## 工作流如何调用 Codex

1. 写入 `$CODEX_HOME/config.toml`，把自定义 provider 指向 `AI_API_URL`，密钥从环境变量 `AI_API_KEY` 读取。
2. 运行 `codex exec --json --sandbox danger-full-access -C "$GITHUB_WORKSPACE" "<prompt 内容>"`，输出 JSONL 事件流用于统计 token。
3. Codex 自行扫描、翻译、迭代，直到没有新的汉化点。
4. 工作流直接提交并推送到当前分支（定时任务是 `main`），不创建 PR、不需要人工介入。

## Token 成本指标

优化汉化逻辑前先建立可对比的指标，避免"感觉省了"。指标分两层。

### 1. 静态评分（离线可复现）

```bash
# 当前配置
node .github/scripts/i18n-token-score.mjs --candidates 48

# 优化前的基线（提示词与批大小都用旧值）
node .github/scripts/i18n-token-score.mjs \
  --prompt .github/codex/localize-zh.prompt.baseline.md --batch-size 8 --candidates 48
```

| 项 | 含义 |
| --- | --- |
| `prompt_tokens_per_call` | 每条 codex 调用重复注入的提示词长度（CJK 按 1 token、其余按 4 字节/token 估算） |
| `calls_per_area_run` | 一轮区域运行发起的 codex 调用次数 |
| `files_per_area_run` | 一轮区域运行处理的候选文件数 |
| `fixed_tokens` | `prompt_tokens_per_call × calls_per_area_run`，重复注入提示词的固定成本 |
| `variable_tokens` | `files_per_area_run × 3000`，读文件/改文件的经验成本（可用 `--file-tokens` 覆盖） |
| `tokens_per_file` | 核心指标：`(fixed + variable) / files` |

注意：静态模型里的 `file_tokens`（默认 3000）只是规划用的假设。实测每个文件约 **19 万 input token**，因为模型每轮都会把不断增长的上下文重发一遍——真实对比以运行期采集为准。

### 2. 实测指标（每次运行自动采集）

工作流解析 `codex exec --json` 的用量事件，按批写入 `.github/i18n-metrics/<run_id>.jsonl`（按运行分文件，避免并发运行互相覆盖），并在每次运行结束时把累计表写进 run summary：

```bash
node .github/scripts/i18n-token-metrics.mjs --aggregate .github/i18n-metrics --summary
```

| 字段 | 含义 |
| --- | --- |
| `tokens_per_file` | 本批总 token ÷ 送入文件数 |
| `tokens_per_changed_file` | 本批总 token ÷ 实际改动文件数（真实单位成本） |
| `waste_ratio` | `1 - 改动文件数 / 送入文件数`，衡量扫描器误报带来的浪费 |

每次运行的记录里还带 `cfg=b<批大小>-r<推理档位>` 标签，用来区分配置版本（例如 `cfg=b12-rhigh` → `cfg=b4-rlow`）。

### 本轮优化（2026-10-14）

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 提示词 | 6978 字节 / 2149 tokens | 6006 字节 / 1835 tokens |
| 每批文件数 | 8 | 12 |
| 每轮处理文件数 | 32 | 48 |
| 固定成本（4 次调用） | 8596 tokens | 7340 tokens |
| 固定成本/文件 | 269 tokens | 153 tokens（**-43%**） |
| `tokens_per_file`（估算） | 3269 | 3153 |

具体改动：

1. 压缩提示词（删重复表述，规则不变），并把"先用 `rg -n` 定位、只读必要区域、不要整文件通读"写进工作方式。
2. 扫描器新增 `--lines` 模式，批次提示词直接把命中行号交给 Codex（形如 `file（命中行：12,48）`），减少整文件读取——这是针对 `variable_tokens` 这个主要成本项。
3. 每批文件数：8 → 12（摊薄提示词固定成本）→ **4**（实测 12 个文件一批会把上下文滚到 ~2.4M input token，多轮重发是主要成本，缩批更能压住膨胀；可用 `vars.QUEUE_BATCH_SIZE` 覆盖）。
4. 接入 `codex exec --json`，按批记录 `tokens_per_file` / `tokens_per_changed_file` / `waste_ratio`。
5. 扫描排除 `.github/**`，避免把汉化工具自身（提示词、工作流）当成待翻译文案反复扫描。
6. `model_reasoning_effort` 默认 `low`（翻译是机械任务，实测 reasoning 输出占比不小；可用 `vars.CODEX_REASONING_EFFORT` 覆盖）。
7. 候选文件按命中次数排序；看过但零改动的文件按内容哈希进跳过名单；零改动不再重排同一区域。

### 真实 A/B 对比方法

`localize-zh.yml` 支持 `prompt_path` 输入，可用同一区域、同一批候选文件跑两次 dry-run 对比真实 token：

```bash
gh workflow run localize-zh.yml -f area=landing -f force_run=true -f dry_run=true \
  -f prompt_path=.github/codex/localize-zh.prompt.baseline.md
gh workflow run localize-zh.yml -f area=landing -f force_run=true -f dry_run=true
```

两次运行都不提交、不推送，起点一致；比较各自 run summary 里的 `tokens/file` 与 `tokens/changed-file` 即可。

### 第二轮实测：缩批 + 低推理档（cfg=b4-rlow）——**未达标**

| 配置 | 批次 | 送入文件 | 改动 | tokens | tokens/file |
| --- | --- | --- | --- | --- | --- |
| b12 | components batch2 | 12 | 11 | 2,510,964 | 209,247 |
| b12 | components batch3 | 12 | 12 | 1,515,641 | 126,303 |
| b4-rlow | utils batch1 | 4 | 0 | 300,196 | 75,049 |
| b4-rlow | utils batch2 | 4 | 0 | **2,470,829** | **617,707** |

结论：缩批与低推理档**没有**降低单位成本，小批次甚至更差。说明成本主要来自模型自己的多轮探索与读取（每轮把增长后的上下文重发），而不是批次大小或推理档位。

### 第三轮优化（提示词变体 p2）

批次指令改为"纯翻译"：

- 只读命中行前后约 30 行，用 `apply_patch` 改完即结束；
- **禁止**读取未列出的文件、禁止运行任何命令（biome / 测试 / 全仓库扫描）；
- **不做**测试断言同步——那部分交给后续「用 Codex 同步失效的测试断言」步骤（只在单元/集成测试失败时触发）。

配置标签会带 `-p2`（例如 `cfg=b4-rlow-p2`），方便和上一轮对比。

### 首次实测（2026-10-14，接入指标后）

`.github/i18n-metrics/` 里早期的一条有效记录（`area=app-pages batch=1`，当时还是单文件 `i18n-metrics.jsonl`）：

| 字段 | 实测值 |
| --- | --- |
| 送入文件数 | 12 |
| 实际改动文件数 | **0** |
| `waste_ratio` | **1.0**（整批全是误报或没来得及改） |
| `input_tokens` | 1,088,281（其中 cached 868,736） |
| `output_tokens` | 26,983（reasoning 20,529） |
| `token_count_events` | 1 |
| `log_bytes` | 205,693 |

结论：当前最大的 token 消耗不在提示词，而在**每个候选文件被大量读取/探索**——12 个文件一批就吃掉约 109 万输入 token，而且这批一个文件都没改。下一步优化方向：

1. 收紧扫描器精度（`waste_ratio` 长期为 1 的区域说明候选大多是误报），减少送进去的文件数。
2. 给批次指令加更硬的读取约束（只读给定行号 ±30 行、不跑全仓库扫描、不读未列出的文件）。
3. 按 `tokens/changed-file` 重新评估批大小：目前 12 个文件一批未必比 6~8 个更划算。

## 直接推送的前提

- 工作流需要 `contents: write`，已在 workflow 中声明。
- 若 `main` 启用了分支保护（要求 PR、状态检查或人工审批），直接推送会被拒绝，工作流会报错退出。需要放行该令牌直接推送，或关闭对应保护规则。
- 未确认：由 `GITHUB_TOKEN` 触发的推送不会再次触发其他工作流，因此这次提交不会自动跑 `build-check`/`playwright`。若希望每次推送都经过 CI，需另行安排（例如改用 PAT，或在推送前先运行校验）。

## 关键约束

Codex CLI 的自定义 provider 目前只支持 Responses API（`wire_api = "responses"` 是唯一取值），base URL 必须提供 `POST /v1/responses`。只支持 Chat Completions 的接口不能直接接入 Codex，需要一个提供 Responses API 的网关在前端转换。

## 仓库配置

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `AI_API_URL` | Secret 或 Variable | 是 | 提供 Responses API 的 base URL，例如 `https://gateway.example.com/v1` |
| `AI_API_KEY` | Secret | 是 | provider 密钥，对应 config.toml 里的 `env_key = "AI_API_KEY"` |
| `AI_MODEL` | Variable | 是 | Codex 使用的模型名，需与网关里配置的模型别名一致 |
| `UPSTREAM_REPO` | Variable | 否 | 上游仓库，默认 `https://github.com/elie222/inbox-zero.git` |
| `UPSTREAM_BRANCH` | Variable | 否 | 上游分支，默认 `main` |
| `CODEX_SANDBOX` | Variable | 否 | Codex 沙箱模式，默认 `danger-full-access`；如需更严格的文件系统沙箱可设为 `workspace-write` |

## 沙箱说明

默认使用 `danger-full-access`。原因是 GitHub 的 runner 不允许 bubblewrap 建立用户/网络命名空间，实测会报 `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`，导致 Codex 一条 shell 命令都执行不了（`workspace-write` 加 `sandbox_workspace_write.network_access = true` 也无效）。

`danger-full-access` 会跳过文件系统沙箱，官方文档的定位就是"仅供外部已隔离的环境使用"，GitHub 托管 runner 属于这类一次性环境。如果自行托管 runner 且 bwrap 可用，可把仓库变量 `CODEX_SANDBOX` 设回 `workspace-write`。
