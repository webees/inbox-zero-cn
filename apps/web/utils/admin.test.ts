import { describe, it, expect, vi, afterEach } from "vitest";

// 在顶层定义常量
const adminEmail = "admin@example.com";
const nonAdminEmail = "user@example.com";
const anotherAdmin = "another@admin.com";
const defaultAdmins = `${adminEmail},${anotherAdmin}`;

// 模拟该结构。实际值会在每个测试中通过 vi.doMock 设置。
// 如果某个测试没有使用 vi.doMock，可能会用到这里的初始值，
// 但为了清晰，在每个测试中都使用 vi.doMock 更稳妥。
vi.mock("@/env", () => ({
  env: {
    ADMINS: defaultAdmins,
  },
}));

describe("isAdmin", () => {
  afterEach(() => {
    // 重置模块可确保动态导入获得与下一个测试中
    // vi.doMock 设置的 mock 关联的新版本。
    vi.resetModules();
  });

  it("should return true if the email is in ADMINS", async () => {
    // 为本测试建立 mock 状态
    await vi.doMock("@/env", () => ({ env: { ADMINS: defaultAdmins } }));
    // 在 mock *之后*动态导入该模块
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: adminEmail })).toBe(true);
  });

  it("should return false if the email is not in ADMINS", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: defaultAdmins } }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: nonAdminEmail })).toBe(false);
  });

  it("should return false if the email is null", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: defaultAdmins } }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: null })).toBe(false);
  });

  it("should return false if the email is undefined", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: defaultAdmins } }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: undefined })).toBe(false);
  });

  it("should be case-sensitive and return false if casing differs", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: defaultAdmins } }));
    const { isAdmin } = await import("./admin");
    // String.includes 区分大小写。"Admin@example.com" 不在 "admin@example.com,..." 中
    expect(isAdmin({ email: "Admin@example.com" })).toBe(false);
  });

  it("should return true if casing matches exactly in ADMINS", async () => {
    await vi.doMock("@/env", () => ({
      env: { ADMINS: `Admin@example.com,${anotherAdmin}` },
    }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: "Admin@example.com" })).toBe(true);
  });

  it("should return false if ADMINS env var is not set (undefined)", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: undefined } }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: adminEmail })).toBeFalsy();
  });

  it("should return false if ADMINS env var is empty", async () => {
    await vi.doMock("@/env", () => ({ env: { ADMINS: "" } }));
    const { isAdmin } = await import("./admin");
    expect(isAdmin({ email: adminEmail })).toBe(false);
  });

  it("should handle spaces around emails in ADMINS env var", async () => {
    // 测试当前行为：String.includes 会查找子串
    await vi.doMock("@/env", () => ({
      env: { ADMINS: ` ${adminEmail} , ${anotherAdmin} ` },
    }));
    const { isAdmin } = await import("./admin");
    // " ${adminEmail} , ...".includes(adminEmail) is true
    expect(isAdmin({ email: adminEmail })).toBe(true);
  });

  it("should handle email match when ADMINS list has extra spaces", async () => {
    await vi.doMock("@/env", () => ({
      env: { ADMINS: `   ${adminEmail}    ,    ${anotherAdmin}   ` },
    }));
    const { isAdmin } = await import("./admin");
    // "   ${adminEmail}    , ...".includes(adminEmail) is true
    expect(isAdmin({ email: adminEmail })).toBe(true);
  });
});
