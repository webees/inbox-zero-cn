# 任务：把 Inbox Zero 仓库的英文内容汉化为简体中文

对这个仓库做简体中文本地化。仓库会持续从上游同步英文代码，因此要把当前存在的英文可读内容全部翻译掉，直到找不到新的汉化点为止。

## 工作方式

1. 只在本次指定的区域内用 ripgrep 扫描（消息开头会给出区域），找出仍含英文可读文本的文件；不要做全仓库扫描。
2. 逐个文件翻译，用精确补丁修改，只改这几类内容，不要顺手重构。
3. 每次改完代码后确认语法正确（例如对改动文件跑 `pnpm exec biome check <文件>`），避免提交被 pre-commit 拦截；三元表达式、模板字符串、JSX 属性等位置最容易漏掉 `:`、`)`、引号。
4. 每译完一批就重新扫描一次，确认是否还有遗漏，反复迭代。
5. 确认没有新的汉化点后停止。不要提交、不要推送、不要创建分支。
6. 完成后输出一份简短清单：改了哪些文件、还剩哪些刻意没改的地方。
7. `.github/workflows/**` 一律不要修改；如果问题来自工作流文件，直接说明并停止，不要尝试修复。

区域之外的文件一律不要读取或修改，也不要因为别处还有英文而留在本区域反复找。本区域处理完就结束。

## 必须翻译

- 用户可见文案：JSX 文本、按钮、菜单、标签页、表头、空状态、加载态、toast、校验提示、错误提示、向导与表单选项
- 用户可见属性：placeholder、title、aria-label、alt，以及展示用的 label/description
- 模板字符串与字符串字面量里的自然语言，保留 `${...}` 内插原样
- 页面 metadata（title/description）、SEO 文案、邮件主题与正文、Slack/Telegram 推送文案
- 全部 Markdown/MDX 文档的标题与正文，包括根目录、`docs/`、各包 README 与 `.github/` 下的文档
- 代码注释里的自然语言（`//`、`/* */`、`<!-- -->`）
- 日志与错误对象里的描述性消息（`console.*`、`logger.*`、`throw new Error` 的文案部分）

## 绝不翻译

- 标识符：变量、函数、类、组件、props、类型、import 路径、文件路径、包名
- 机器可读字符串：对象键、枚举值与字面量联合（`z.enum`、`as const`、union）、数据库字段与表名、API 路由、URL、query 参数、HTTP header、环境变量名、正则、CSS 类名与选择器、颜色值、MIME、日期/时区/货币格式串、命令行与参数
- 测试钩子：`data-testid`、`id`、`name`、`htmlFor`、`key`
- 指令性注释：`biome-ignore`、`eslint-disable`、`@ts-expect-error`、`@ts-ignore`、`#region`、`TODO(姓名)`、许可证头、注释里的 URL
- LLM 资产：`apps/web/utils/ai/**` 下的系统提示词与工具描述、`*prompt*` 文件、JSON Schema 字段名、模型名、prompt 模板变量
- 品牌与技术名：Inbox Zero、Gmail、Google、Outlook、Microsoft、Slack、Telegram、Stripe、Lemon、OpenAI、Anthropic、Vercel 等
- 已经是中文的内容：保持原样，不要改写，不要替换标点
- 已本地化的名称映射：`apps/web/utils/rule/consts.ts`（系统规则名与标签名）、`apps/web/utils/split-inbox/split-library.ts`（分类名与标签名）、`apps/web/utils/category-config.tsx`、`apps/web/utils/categories.ts`（发件人分类名）现在都是中文，并且和数据库行、Gmail 标签、Outlook 类别逐字对应。保持原样，不要翻译、不要改写、不要还原成英文；这些文件的匹配用字符串（`label`/`name`/`labelName`/`storageKey`/枚举值/数据库字段）改了会破坏标签匹配与 AI 分类行为。
- 但 `consts.ts` 里的 `instructions`（AI 提示词）与 `DEFAULT_COLD_EMAIL_PROMPT` 仍是英文，属于 LLM 资产，同样不要翻译。

## Markdown 规则

- 翻译标题、正文段落、列表项、表格文字、图片 alt，以及 frontmatter 中面向读者的值（title/description）
- 保留不动：代码块与行内代码、命令、URL、链接地址、HTML 标签与属性名、frontmatter 键名、锚点 id、导入语句、MDX 组件名与 props

## 格式与术语

- 保留占位符与内插：`{count}`、`${name}`、`%s`、`{{value}}`、`&nbsp;`、`\n`、`\t`、HTML 标签、emoji
- 中文使用全角标点，句末不加英文句号
- 统一术语：inbox=收件箱；thread=会话；email account=邮箱账号；rule=规则；label=标签；draft=草稿；reply=回复；forward=转发；archive=归档；unsubscribe=退订；cold email=冷邮件；sender=发件人；recipient=收件人；digest=邮件摘要；meeting brief=会议简报；bulk archiver=批量归档；attachment=附件；AI assistant=AI 助手；persona=用户画像；plan=套餐；credits=额度；premium=高级版；organization=组织；member=成员；onboarding=引导流程；Reply Zero 与 Inbox Zero 保留英文
- 拿不准但确实是自然语言英文时按翻译处理；只有能明确判定为标识符、键名或机器可读值时才保留英文

## 范围限制

本次运行由调用方指定**一个区域**，只处理该区域：区域内的源代码、测试文件与 `.md`/`.mdx` 文档。区域之外的文件保持原样。跳过 `node_modules`、构建产物与测试快照（`__snapshots__/**`）。

## 测试文件同步

界面文案一旦改动，断言这些文案的测试就会失败，所以必须同步**所有**引用「用户可见文案」的测试，不只是同目录的单元测试：

- 覆盖范围：与源码同目录的 `*.test.ts(x)`，以及 `apps/web/__tests__/**` 下的单元、集成、E2E 测试。集成测试最容易漏，例如 `__tests__/integration/slack-notifications.test.ts`（Slack 卡片标题/按钮/摘要）、`custom-mcp-server.test.ts`（连接错误文案）、`recall-meeting-lifecycle.test.ts`（失败原因文案）。
- 只更新引用「用户可见文案」的字符串：`getByRole(...)` 的 `name`、`getByText`、`getByLabelText`、`findByText`，以及 `toHaveBeenCalledWith` / `toEqual` / `toContain` / `toMatch` 里出现的 title、description、按钮与提示文案；Slack/Telegram 卡片里的 `text`、`label`、`submitLabel`、`title` 同样属于用户可见文案。
- 改完源码后必须运行受影响的测试并修到通过：`pnpm -F inbox-zero-ai exec vitest run <测试文件>`。注意跨模块的断言——例如改了 `attachment-source-selection.ts` 的计数文案，除了它自己的测试，还要跑引用这些文案的组件测试（如 `ActionAttachmentsField.test.tsx`）；改了 `ResultDisplay.tsx` 的提示文案，要跑 `ResultDisplay.test.tsx`、`ThreadSkipHint` 相关断言等。
- 结束本区域前，必须跑完这两条命令并全部通过：`pnpm -F inbox-zero-ai test --run` 和 `pnpm -F inbox-zero-ai test-integration`（后者覆盖 `apps/web/__tests__/integration/**`）。
- 不要改测试逻辑、断言结构、`data-testid`、mock 名、函数名、选择器写法。
- 翻译结果必须与源码里的文案逐字一致，包括标点与空格。
- 测试里的英文注释可以翻译；测试名称（`it("...")`）保持原样，不要改。

## 不要动 Playwright

`apps/web/__tests__/playwright/**` 一律保持原样，不要修改其中任何文件。这套 E2E 依赖英文可见文案选择器，本仓库已停用对应的 Playwright 工作流；改这些文件只会产生大量噪声，并在每次同步上游时持续冲突。
