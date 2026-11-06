# 浏览器退订 worker

为现有退订操作提供可选启用的浏览器自动化。Web 应用从已认证账号的邮箱中解析出链接，并且只发送该链接、其收件人邮箱和一个随机任务 ID。协调器会创建一个全新沙箱，驱动一个有边界的浏览器会话，并在返回结果之前销毁沙箱。

此应用**不会**由 Docker Compose、`pnpm dev` 或 Web 镜像启动。不希望使用它的自托管者应在 Web 应用上保持 `UNSUBSCRIBE_WORKER_URL` 未设置；此时退订会保留现有的 HTTP 流程。

只有页面明确确认才能产生 `confirmed`。仅 HTTP 成功并不够。登录、CAPTCHA、范围不明确和不支持的页面会返回 `needs_user` 或 `failed`；界面保留手动退订的兜底方案。页面确认仍不能证明未来的邮件会停止。

没有数据库 schema 变更。现有结构化日志会记录成功的方法、发件人 ID 和完成时间；后续被拦截邮件的日志包含发件人 ID 和原始接收时间。按账号/发件人关联这些事件，对邮件 ID 去重，并预留投递宽限期。日志保留期限和邮件处理不完整仍会限制纵向分析；这不是持久的退订审计轨迹。

## 架构与隐私边界

- 协调器是可信的，持有服务密钥和模型凭证。邮箱服务商凭证仍保留在 Web 应用中，由它解析退订链接并仅发送 `jobId`、`url` 和 `recipientEmail`。协调器与 Web 应用分开运行。协调器一旦被攻破，可能访问并发任务数据，因此其主机和依赖仍属于可信计算基。
- 每个任务都有独立的操作系统沙箱、浏览器进程/上下文、能力令牌、模型历史和网络命名空间。沙箱绝不会收到邮箱 OAuth 令牌、数据库凭证、其他任务或模型/服务商 API 密钥。任务之间不共享浏览器或沙箱。
- 浏览器流量经由 TLS CONNECT 代理。该代理解析并固定公网 IPv4 目标，拒绝私有/保留地址及其自身 IP，并且只允许目标端口 443。请求、隧道、字节数、控件操作和模型步骤都设有上限。TLS 验证保持启用。这会刻意排除明文站点和仅支持 IPv6 的站点。
- 运行器可以点击已观察到的控件、仅输入所属收件人邮箱、选择已观察到的选项，或停止。新的模型提示词将页面视为不可信，并将操作限制为所请求的退订。这是 AI 判断边界，并不能防范同页面内的欺骗性内容。它无法执行模型提供的脚本，也无法访问其他任务。
- 令牌在完成/取消时撤销。工作上限为 120 秒，另加最多 30 秒的等待清理时间；Web 调用方允许 170 秒。每个沙箱还有独立的 3 分钟到期时间。清理未确认时，在运维人员调查并重启服务之前，会停止接受新任务。
- 应用不存储截图、浏览器配置文件或页面正文。配置的模型会收到页面文本和控件，其中可能包含个人数据或退订令牌。请使用符合你隐私要求的服务商和保留策略，或使用独立托管且兼容的模型端点。在周边基础设施中禁用请求正文、命令输出和代理凭证日志。

## 配置协调器

使用 Node 24，并在仓库根目录安装：

```sh
pnpm install --filter @inboxzero/unsubscribe-worker --config.enable-global-virtual-store=false
```

直接运行 `pnpm install` 会通过 `$HOME` 下的 store 链接依赖，而保护主目录的服务单元无法跟随该路径。请将此应用的 `.env.example` 复制到受保护的环境文件，并填写必填字段。

将 `UNSUBSCRIBE_BROKER_URL` 设为专用 TLS 主机名，将 `UNSUBSCRIBE_BROKER_IP` 设为其可从沙箱访问的固定 IPv4 地址。broker 地址必须**仅向沙箱流量暴露 broker 端口**。管理服务应放在另一个地址/接口上。设置 TLS 证书/密钥文件路径及对应的监听端口。运行器应使用受公网信任的证书；不要禁用 TLS 验证。

将 `UNSUBSCRIBE_MODEL_ENDPOINT` 设为完整的 HTTPS chat-completions 端点，并配置模型名称和 API 密钥。该端点必须接受 JSON-object 输出、`max_tokens` 和 `temperature`，并返回 `choices[0].message.content`。没有隐式的模型服务商或凭证回退。

以受监管服务运行协调器，并加载其受保护环境：

```sh
cd apps/unsubscribe-worker
node --env-file=/etc/unsubscribe-worker.env src/index.ts
```

协调器在同一 TLS 端口上提供 `/jobs`、`/decision` 和需认证的 CONNECT。许多 HTTP 反向代理不会转发 CONNECT；请使用直接 TLS 或兼容的 TCP 负载均衡器。会话保存在内存中：初期请使用单个协调器实例。多实例部署时，broker 地址必须固定到拥有该任务的实例。不要在各实例之间随机负载均衡请求。默认并发容量为 2；额外的任务会立即失败，用户可重试。

## 自托管 Docker + gVisor

这是随附的沙箱适配器。请使用专用 Linux 主机，配备 Docker、`runsc` gVisor 运行时、systemd，以及支持 nftables netdev 出站规则的 Linux 5.16+。协调器需要有权运行 Docker、调度并停止 `systemd-run` 到期计时器。这些是特权主机操作：不要向任何浏览器容器暴露 Docker socket。独立计时器需要存在 `/usr/bin/docker`。

在仓库根目录构建这些镜像：

```sh
docker build -f apps/unsubscribe-worker/Dockerfile -t unsubscribe-runner .
docker build -f apps/unsubscribe-worker/Dockerfile.router -t unsubscribe-router apps/unsubscribe-worker
```

设置 `UNSUBSCRIBE_SANDBOX_IMAGE=unsubscribe-runner` 和 `UNSUBSCRIBE_ROUTER_IMAGE=unsubscribe-router`。请预先拉取/构建镜像；运行时不允许安装软件包。

每个任务都会启动一个小的可信路由容器，用于安装默认拒绝的 IPv4/IPv6 和设备出站规则。设备出站过滤是必需的，因为 gVisor 使用原始 AF_PACKET 网络，会绕过普通的 IP OUTPUT 过滤。参见 [gVisor 网络架构](https://gvisor.dev/docs/architecture_guide/networking/) 和 [netfilter 设备钩子](https://netfilter.org/projects/nftables/manpage.html)。一个独立的、无特权且只读的 gVisor 浏览器会加入该任务的网络命名空间，且不具备网络管理能力、主机挂载或继承的凭证。临时浏览器数据存放在有大小上限的 tmpfs 上。主机在任务数据进入沙箱之前就安排好删除。缺少 systemd、防火墙支持或 gVisor 都会导致失败；没有普通容器兜底方案。macOS 上的标准 Docker Desktop 不是此部署目标。

## 启用 Web 应用

在 Web 应用中仅设置 `UNSUBSCRIBE_WORKER_URL` 和 `UNSUBSCRIBE_WORKER_SECRET`。在协调器上使用相同的高熵密钥（至少 32 个字符）。模型凭证只能放在协调器上。现有退订操作随后会依次尝试一键 POST、简单 HTML 表单和浏览器 worker。worker 失败时，不会退而将成功的 HTTP GET 视为退订确认。保持 URL 未设置即可保留现有 HTTP 行为，包括 GET 成功。

调用方页面和退订路由允许 180 秒。请配置托管平台以支持该时长。大型批量请求可能超过平台截止时间，因为每个选中的发件人都会启动独立工作；此实现没有增加持久队列或批处理调度器。

## 添加服务商

Docker + gVisor 是唯一随附的适配器。保留 `src/contracts.ts` 中的 `SandboxAdapter`，以便日后添加其他隔离后端时无需改动浏览器或 broker 逻辑。服务商必须提供全新的操作系统隔离边界、受限出站、独立到期时间和已确认的销毁。遵守取消操作，并清理延迟创建的实例。不要用共享浏览器上下文替代沙箱。

## 验证

```sh
pnpm --filter @inboxzero/unsubscribe-worker typecheck
pnpm --filter @inboxzero/unsubscribe-worker exec playwright install chromium
pnpm --filter @inboxzero/unsubscribe-worker test
pnpm --filter @inboxzero/unsubscribe-worker test-ai
pnpm test utils/senders/browser-unsubscribe.test.ts utils/senders/unsubscribe.test.ts utils/senders/html-form-unsubscribe.test.ts
```

默认测试覆盖带脚本化决策的本地浏览器表单、HTTP 一键退订、简单 HTML 表单、worker 兜底以及 Docker 隔离。它们不能证明实时模型准确率或主机隔离。

`pnpm --filter @inboxzero/unsubscribe-worker test-ai` 使用真实模型（`UNSUBSCRIBE_MODEL_*` 或 `OPENAI_API_KEY`）运行相同的页面。这些测试夹具通过 `page.setContent` 注入；不需要 HTTPS 或沙箱。在使用真实账号链接之前，请在所选主机上测试合成任务：直接访问互联网/私有地址/元数据必须失败，broker 访问必须成功，并行任务不得看到彼此的文件/进程，终止协调器后沙箱仍必须按独立到期时间被移除。使用配置的模型测试延迟确认、登录/CAPTCHA 和提示词注入。从运维层面验证删除。
