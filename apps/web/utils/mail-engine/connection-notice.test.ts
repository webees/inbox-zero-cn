import { describe, expect, it } from "vitest";
import { mailEngineConnectionCopy } from "./connection-notice";

describe("mailEngineConnectionCopy", () => {
  it("asks the user to reconnect when auth is blocked", () => {
    expect(mailEngineConnectionCopy("blocked_auth")).toEqual({
      title: "重新连接此账号以继续同步。",
      description: "在重新连接此账号之前，邮箱补收将暂停。",
      action: "重新连接",
    });
  });

  it("explains automatic retry while the mailbox is offline", () => {
    expect(mailEngineConnectionCopy("offline")).toEqual({
      title: "等待同步。",
      description: "补收会自动重试。",
    });
  });

  it("is silent while the mailbox is ready", () => {
    expect(mailEngineConnectionCopy("ready")).toBeUndefined();
    expect(mailEngineConnectionCopy(undefined)).toBeUndefined();
  });
});
