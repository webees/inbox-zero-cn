# ClawHub / OpenClaw + Cursor

此文件夹是 Inbox Zero API CLI（`@inbox-zero/api`，二进制文件 `inbox-zero-api`）的**规范**打包技能。

- **OpenClaw**：从此处发布或安装；参见 `inbox-zero-api/SKILL.md` frontmatter 中的 `metadata.openclaw`。
- **Cursor Directory**：仓库根目录包含 `.cursor-plugin/plugin.json`。技能通过 `skills/inbox-zero-api` → 指向此目录的符号链接暴露，这样 Open Plugins 发现机制能够找到 `skills/*/SKILL.md` 而无需重复文件。

只在 `inbox-zero-api/` 下编辑内容；Cursor 插件会自动获取它。
