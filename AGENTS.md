# 仓库指南

## 构建与测试命令
- 开发：`pnpm dev`
- 构建：`pnpm build`
- Lint：`pnpm lint`
- 格式化：Biome（通过 ultracite 执行 `pnpm check` / `pnpm fix`）
- 运行全部测试：`pnpm test`
- 运行集成测试：`pnpm test-integration`
- 运行 AI 测试：`pnpm --filter inbox-zero-ai test-ai`
- 运行单个测试：`pnpm test path/to/test-file.test.ts`
- 运行针对性的浏览器测试：`pnpm -F inbox-zero-ai test:playwright:emulated <area-or-spec>`；对于面向浏览器 UI 的改动，结束前先查看生成的截图
- 移动、重命名或隐藏某个 UI 交互元素会破坏按可见名称选择它的测试。推送前先 grep `__tests__/playwright` 查找该名称，绝不要把 grep 结果通过管道传给 `head` —— 被截断的结果当成完整结果会漏掉调用点。截图不会发现这一点，UI 看起来仍然正常。
- 等待耗时任务（CI、Playwright 运行、构建）时：在后台运行一条命令，等任务真正完成时它才退出。任务退出时 harness 会通知你，因此在其之上再加轮询循环只会重复那个信号。
- 为任何可能挂起的操作设置边界，让它总会退出并报告，而不是永远等待。macOS 上没有 `timeout(1)`；请使用 Bash 工具自带的 `timeout` 参数，或 `perl -e 'alarm shift; exec @ARGV' <seconds> <command>`。如果必须匹配日志输出，请把模式锚定到真正的汇总行（`^\s+[0-9]+ (passed|failed)`），而不是启动横幅里也会出现的裸 `failed`。
- 运行特定的 AI/eval 测试：`pnpm --filter inbox-zero-ai test-ai __tests__/eval/your-test.test.ts`
- `apps/web/__tests__/eval/` 中的 eval 必须从仓库根目录用 `pnpm --filter inbox-zero-ai test-ai` 运行（不能用 `pnpm test`）
- 类型检查构建（跳过 Prisma migrate）：`pnpm --filter inbox-zero-ai exec next build`
- 不要使用根目录的 `tsc --noEmit`；它不是本 monorepo 支持的校验步骤，会暴露大量无关的仓库级债务。如果你需要与应用 CI 对齐的类型/构建检查，请改用 `pnpm --filter inbox-zero-ai build:ci`，且仅在明确要求时使用。
- 除非明确要求，不要运行 `dev` 或 `build`
- 如果尚未执行，请在运行测试或构建前先运行 `pnpm install`
- 在编写或更新测试前，先阅读 `.claude/skills/testing/SKILL.md`。
- 对于核心 bug 修复任务，在可行时默认采用 TDD（红/绿/重构）；AI 提示词改进通常也应有 eval 支撑，此时 TDD 往往同样有用。
- 新增 workspace 包时，把它的 `package.json` COPY 行加到 `docker/Dockerfile.prod` 和 `docker/Dockerfile.local`。

## 代码风格
- 在 `apps/web` 中安装包，而不是根目录：`cd apps/web && pnpm add ...`
- Lodash：按需导入具体函数（`import groupBy from "lodash/groupBy"`）
- TypeScript，启用严格空值检查
- 路径别名：`@/` 表示从项目根目录导入
- NextJS app router，使用 (app) 目录，tailwindcss
- 对于版本敏感或不明确的 Next.js 行为，改动框架代码前先查阅 `node_modules/next/dist/docs/` 中的相关文档。
- 只为"为什么"添加注释，不为"做什么"。优先使用自解释的代码。
- 日志：避免重复记录调用链上游已有的 logger 上下文字段。对 PII 字段（from、to、subject 等）使用 `logger.trace()`。例外：已认证用户本人的邮箱可以在任意级别记录。
- 测试应使用真实的 logger 实现（不要 mock `@/utils/logger`）。
- 避免主要是在复述实现细节的低价值测试；优先编写能捕捉真实行为回归的测试。
- 辅助函数放在文件底部，而不是顶部
- 所有 import 都放在文件顶部，不要在文件中间做动态 import
- 避免用 `useEffect` 把获取到的 props/数据镜像到本地 state；优先使用派生值或显式的编辑状态。
- 单元测试与源文件放在一起（例如 `utils/example.test.ts`）。集成、E2E 和 AI 测试放在 `__tests__/`。
- 不要导出仅在同一文件内使用的类型/接口
- 不要使用 re-export 模式。从原始来源导入。
- 优先使用 `EmailProvider` 抽象；只在真正的服务商边界/集成代码中使用服务商类型检查（`isGoogleProvider`、`isMicrosoftProvider`）。
- 使用 `z.infer<typeof schema>` 从 Zod schema 推断类型，而不是重复定义为单独的接口
- 默认在调用处内联并就近放置逻辑。
- 避免过早抽象。小的重复表达式通常没问题；把它们抽出来往往只增加无意义的间接层。
- 不要重复实质性逻辑或对正确性敏感的关键规则。如果复制的代码必须保持同步以避免 bug，应尽早提取或集中管理。
- 当辅助函数能让周围代码更清晰、命名一个有意义的领域概念，或让多个流程中的共享行为保持一致时，就提取它。
- 不要提取只是重命名并转发参数的辅助函数；那是一层没有意义的封装。
- 避免大型/嵌套的三元表达式。在能提升可读性时，优先使用直白的控制流、小型辅助函数或查找表。
- 不要使用 barrel 文件。直接从源文件导入。
- 页面组件就近放在其 `page.tsx` 旁边。路由目录中不要有嵌套的 `components/` 子目录。
- 跨页面共享的可复用组件放在 `apps/web/components/`
- 每个 API 路由文件只负责一种资源
- 环境变量：加到 `.env.example`、`env.ts` 和 `turbo.json`。客户端变量以 `NEXT_PUBLIC_` 为前缀。
- 绝不使用动态 Prisma 事务（`prisma.$transaction(async (tx) => ...)`）。

## 变更理念
- 尊重模块边界：把功能专属逻辑留在其所属功能中，让共享基础设施保持通用。
- 优先选择最简单、最可读的改动；仅在明确要求时才保留向后兼容。
- 不要为迁移路径做优化：直接重构调用点，包括在能提升清晰度时进行更大范围的协同改动。
- 这是公开仓库。绝不要在仓库内容或 GitHub 元数据中包含非公开数据或来自私有仓库/服务的内部细节；相关私有工作只做笼统描述（例如"更新了营销仓库"）。

## LLM 功能
- 保持 AI 优先：修复通用的失败模式，而不是精确的 eval 措辞；除非产品需要硬性防护，避免脆弱的 keyword 或 regex 规则。
- 不要为了捕捉模型当前的糟糕措辞而向提示词、eval 或测试中加入关键词/短语黑名单。本产品支持多种语言，因此针对英文文本的检查尤其脆弱。对于 LLM 行为，应使用 judge/eval 判定标准或结构化契约来断言语义层面的失败模式。示例：测试"不提出不必要的澄清问题，也不臆造支付状态"，而不是"不包含 'could you clarify' 或 'specific payment'"。
- 绝不要根据临时的用户文本关键词匹配来决定上下文注入或工具行为；请改用结构化状态、元数据或显式事件。
- 工具描述应自包含：该工具做什么、其参数含义、何时使用它而非替代方案、前置条件，以及该工具特有的安全约束。
- 系统提示词中只保留跨领域的策略（身份、写入确认、安全、格式）。针对单个工具的指引应放在工具描述中，使其只在该工具启用时出现。
- 把提示词、工具和参数视为成本高昂的面向模型的表面。每一行都必须有其价值；不要为边缘情况添加工具或参数，添加两者中的任何一个前都要获得用户的明确批准。
- 不要在提示词和工具描述之间重复指引。向用户明确披露任何提示词、工具或工具参数的改动。
- 保持面向模型的 schema 可移植：优先使用扁平的根对象，并在各服务商之间验证高级构造。仅在丢弃未知键不安全时使用 `z.strictObject()`；在工具字段中描述细化与转换约束，因为模型可能看不到它们。

## 组件指南
- 可用时使用 shadcn/ui 组件
- 对异步数据使用 `LoadingContent` 组件：`<LoadingContent loading={isLoading} error={error}>{data && <YourComponent data={data} />}</LoadingContent>`

## 全栈工作流
完整的示例与模板请参阅 `.claude/skills/fullstack-workflow/SKILL.md`。

- API 路由中间件：`withError`（公开，无认证）、`withAuth`（用户级）、`withEmailAccount`（邮箱账号级）。通过 `Awaited<ReturnType<typeof getData>>` 导出响应类型。
- 变更操作：使用基于 `next-safe-action` 的 server action，不要用 POST API 路由。
- 例外：当移动端原生集成需要稳定的 HTTP 契约时，可以使用 POST API 路由。
- 校验：Zod schema 放在 `utils/actions/*.validation.ts`。用 `z.infer` 推断类型。
- 数据获取：客户端使用 SWR。变更后调用 `mutate()`。
- 表单：React Hook Form + `useAction` hook。错误处理使用 `getActionErrorMessage(error.error)`。
- 加载状态：使用 `LoadingContent` 组件。
- Cursor Cloud VM 设置：参见 `.claude/skills/cloud-dev-environment/SKILL.md`。
- 创建 PR：`.claude/skills/create-pr/SKILL.md`。把 PR 跟到变绿（CI、审查机器人、评论）：`.claude/skills/pr-watch/SKILL.md`。不要手工轮询 `gh api`；`pr-digest --watch` 已经会阻塞到各项检查稳定，并在 `PR_DIGEST_DEADLINE`（3600 秒）时以一行 `WAIT_LIMIT` 放弃，而不是一直挂起。
