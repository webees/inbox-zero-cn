import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAwsSetup, validateEnvironmentName } from "./setup-aws";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe("validateEnvironmentName", () => {
  it("accepts Copilot environment names used by the interactive prompt", () => {
    expect(validateEnvironmentName("production")).toBeUndefined();
    expect(validateEnvironmentName("staging-2")).toBeUndefined();
  });

  it("rejects unsafe or invalid environment names", () => {
    expect(validateEnvironmentName("../production")).toBe(
      "必须以字母开头，且只能包含小写字母、数字和连字符",
    );
    expect(validateEnvironmentName("Production")).toBe(
      "必须以字母开头，且只能包含小写字母、数字和连字符",
    );
    expect(validateEnvironmentName("")).toBe("环境名称为必填项");
  });
});

describe("runAwsSetup", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects unattended setup before AWS calls when runtime Bedrock keys are absent", async () => {
    vi.stubEnv("BEDROCK_ACCESS_KEY", "");
    vi.stubEnv("BEDROCK_SECRET_KEY", "");
    await expect(
      runAwsSetup({ yes: true, environment: "staging" }),
    ).rejects.toThrow(/BEDROCK_ACCESS_KEY.*BEDROCK_SECRET_KEY/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("rejects invalid --environment values before shelling out", async () => {
    await expect(runAwsSetup({ environment: "../production" })).rejects.toThrow(
      "process.exit:1",
    );

    expect(p.log.error).toHaveBeenCalledWith(
      "无效的环境名称：必须以字母开头，且只能包含小写字母、数字和连字符",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
