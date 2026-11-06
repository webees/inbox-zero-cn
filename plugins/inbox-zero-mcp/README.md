# Inbox Zero MCP 插件

连接 Inbox Zero MCP 服务器的 Cursor 插件。

## 安装

把此目录复制或软链接到 `~/.cursor/plugins/local/inbox-zero-mcp`，然后重新加载 Cursor。

把 `mcp.json` 中的 URL 设置为你的 Inbox Zero 源地址，例如 `https://www.getinboxzero.com/mcp` 或 `https://your-inbox-zero-host/mcp`。

也可以不用插件，把该 `mcp.json` 加入 `~/.cursor/mcp.json` 即可连接。

## 文件

- `plugin.json` — Agent Plugins 清单
- `mcp.json` — 远程 Streamable HTTP MCP URL
- `skills/inbox-zero-mcp/SKILL.md` — 如何在不发送的情况下搜索、阅读和起草

OAuth 使用动态客户端注册。
