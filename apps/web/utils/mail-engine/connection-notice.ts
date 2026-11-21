export function mailEngineConnectionCopy(
  connection: "ready" | "offline" | "blocked_auth" | undefined,
) {
  if (connection === "blocked_auth") {
    return {
      title: "重新连接此账号以继续同步。",
      description: "在重新连接此账号之前，邮箱补收将暂停。",
      action: "重新连接",
    };
  }
  if (connection === "offline") {
    return {
      title: "等待同步。",
      description: "补收会自动重试。",
    };
  }
}
