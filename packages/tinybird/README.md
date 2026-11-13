# Tinybird

[`project`](project) 目录是 `InboxZero` 工作区的标准 Tinybird Forward 项目。它包含所有分析资源，包括 `@inboxzero/tinybird-ai-analytics` 使用的 AI 分析资源。

## CLI 设置

运行当前的 Forward CLI，同时避免与 `PATH` 中已有的 Classic CLI 冲突：

```sh
uvx --from tinybird@latest tb --version
```

身份验证并选择生产工作区：

```sh
cd packages/tinybird/project
uvx --from tinybird@latest tb login --host https://api.us-east.tinybird.co --workspace InboxZero
```

## 开发工作流

拉取当前的云端定义：

```sh
uvx --from tinybird@latest tb --cloud pull
```

启动 Tinybird Local 并在本地验证项目：

```sh
uvx --from tinybird@latest tb local start
uvx --from tinybird@latest tb build
uvx --from tinybird@latest tb test run
```

验证并将项目部署到 Tinybird Cloud：

```sh
uvx --from tinybird@latest tb --cloud deploy --check
```

从项目中移除数据源会在下一次部署时删除该数据源及其数据。Forward 会先请求确认；
请查看 `--check` 输出，然后使用 `--allow-destructive-operations` 进行部署。

Tinybird Forward 部署取代了 Classic `tb push` 工作流。请将资源定义和 `TOKEN`
指令保留在 `packages/tinybird/project` 中，以便部署可以从 Git 重现。
