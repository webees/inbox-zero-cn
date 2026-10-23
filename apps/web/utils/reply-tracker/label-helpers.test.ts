import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { applyThreadStatusLabel } from "./label-helpers";
import type { EmailProvider } from "@/utils/email/types";
import prisma from "@/utils/__mocks__/prisma";
import { createTestLogger } from "@/__tests__/helpers";
import { SystemType } from "@/generated/prisma/enums";
import { getRuleLabel } from "@/utils/rule/consts";

const logger = createTestLogger();

// 标签名会随本地化改动，这里统一从规则配置里取，避免测试写死英文。
const TO_REPLY = getRuleLabel(SystemType.TO_REPLY);
const AWAITING_REPLY = getRuleLabel(SystemType.AWAITING_REPLY);
const FYI = getRuleLabel(SystemType.FYI);
const ACTIONED = getRuleLabel(SystemType.ACTIONED);

const LABEL_ID_BY_NAME: Record<string, string> = {
  [TO_REPLY]: "label-to-reply",
  [AWAITING_REPLY]: "label-awaiting-reply",
  [FYI]: "label-fyi",
  [ACTIONED]: "label-actioned",
};

vi.mock("@/utils/prisma");

describe("applyThreadStatusLabel", () => {
  let mockProvider: EmailProvider;
  const emailAccountId = "test-account-id";
  const threadId = "test-thread-id";
  const messageId = "test-message-id";
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock email provider methods
    mockProvider = {
      removeThreadLabels: vi.fn().mockResolvedValue(undefined),
      labelMessage: vi.fn().mockResolvedValue({}),
      getLabels: vi.fn().mockResolvedValue([
        { id: "label-to-reply", name: TO_REPLY, type: "user" },
        { id: "label-awaiting-reply", name: AWAITING_REPLY, type: "user" },
        { id: "label-fyi", name: FYI, type: "user" },
        { id: "label-actioned", name: ACTIONED, type: "user" },
      ]),
      getLabelById: vi.fn().mockResolvedValue(null),
      getLabelByName: vi.fn().mockResolvedValue(null),
      createLabel: vi.fn().mockImplementation(async (name: string) => ({
        id: LABEL_ID_BY_NAME[name] ?? `label-${name}`,
        name,
        type: "user",
      })),
    } as unknown as EmailProvider;

    // Mock prisma to return rules with label IDs
    vi.mocked(prisma.rule.findMany).mockResolvedValue([
      {
        id: "rule-1",
        systemType: "TO_REPLY",
        actions: [{ id: "action-1", type: "LABEL", labelId: "label-to-reply" }],
      },
      {
        id: "rule-2",
        systemType: "AWAITING_REPLY",
        actions: [
          { id: "action-2", type: "LABEL", labelId: "label-awaiting-reply" },
        ],
      },
      {
        id: "rule-3",
        systemType: "FYI",
        actions: [{ id: "action-3", type: "LABEL", labelId: "label-fyi" }],
      },
      {
        id: "rule-4",
        systemType: "ACTIONED",
        actions: [{ id: "action-4", type: "LABEL", labelId: "label-actioned" }],
      },
    ] as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("removes other labels from thread and adds target label to message for TO_REPLY", async () => {
    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "TO_REPLY",
      provider: mockProvider,
      logger,
    });

    // Should remove other conversation status labels from thread
    expect(mockProvider.removeThreadLabels).toHaveBeenCalledTimes(1);
    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining([
        "label-awaiting-reply",
        "label-fyi",
        "label-actioned",
      ]),
    );

    // Verify it doesn't remove the target label
    const removeCall = vi.mocked(mockProvider.removeThreadLabels).mock.calls[0];
    expect(removeCall[1]).not.toContain("label-to-reply");

    // Should add TO_REPLY label to the specific message
    expect(mockProvider.labelMessage).toHaveBeenCalledTimes(1);
    expect(mockProvider.labelMessage).toHaveBeenCalledWith({
      messageId,
      labelId: "label-to-reply",
    });
  });

  test("removes other labels from thread and adds target label to message for AWAITING_REPLY", async () => {
    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "AWAITING_REPLY",
      provider: mockProvider,
      logger,
    });

    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining(["label-to-reply", "label-fyi", "label-actioned"]),
    );

    expect(mockProvider.labelMessage).toHaveBeenCalledWith({
      messageId,
      labelId: "label-awaiting-reply",
    });
  });

  test("removes other labels from thread and adds target label to message for FYI", async () => {
    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "FYI",
      provider: mockProvider,
      logger,
    });

    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining([
        "label-to-reply",
        "label-awaiting-reply",
        "label-actioned",
      ]),
    );

    expect(mockProvider.labelMessage).toHaveBeenCalledWith({
      messageId,
      labelId: "label-fyi",
    });
  });

  test("removes other labels from thread and adds target label to message for ACTIONED", async () => {
    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "ACTIONED",
      provider: mockProvider,
      logger,
    });

    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining([
        "label-to-reply",
        "label-awaiting-reply",
        "label-fyi",
      ]),
    );

    expect(mockProvider.labelMessage).toHaveBeenCalledWith({
      messageId,
      labelId: "label-actioned",
    });
  });

  test("does not log success when removing conflicting labels fails", async () => {
    vi.mocked(mockProvider.removeThreadLabels).mockRejectedValueOnce(
      new Error("Failed to remove labels"),
    );

    await expect(
      applyThreadStatusLabel({
        emailAccountId,
        threadId,
        messageId,
        systemType: "TO_REPLY",
        provider: mockProvider,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("移除冲突的会话标签失败"),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Removed conflicting thread status labels"),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Thread status label applied successfully"),
    );
  });

  test("does not log success when adding the target label fails", async () => {
    vi.mocked(mockProvider.labelMessage).mockRejectedValueOnce(
      new Error("Failed to add label"),
    );

    await expect(
      applyThreadStatusLabel({
        emailAccountId,
        threadId,
        messageId,
        systemType: "TO_REPLY",
        provider: mockProvider,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("应用会话状态标签失败"),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Thread status label applied successfully"),
    );
  });

  test("uses provider label when label ID not in database", async () => {
    // Mock prisma to return rules without one label
    vi.mocked(prisma.rule.findMany).mockResolvedValue([
      {
        id: "rule-1",
        systemType: "TO_REPLY",
        actions: [{ id: "action-1", type: "LABEL", labelId: "label-to-reply" }],
      },
      {
        id: "rule-2",
        systemType: "AWAITING_REPLY",
        actions: [
          { id: "action-2", type: "LABEL", labelId: "label-awaiting-reply" },
        ],
      },
      // FYI is missing from DB
      {
        id: "rule-4",
        systemType: "ACTIONED",
        actions: [{ id: "action-4", type: "LABEL", labelId: "label-actioned" }],
      },
    ] as any);

    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "TO_REPLY",
      provider: mockProvider,
      logger,
    });

    // Should still include FYI label from provider labels
    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining([
        "label-awaiting-reply",
        "label-fyi", // From provider labels, not DB
        "label-actioned",
      ]),
    );
  });

  test("uses hidden provider label when visible labels omit the DB label ID", async () => {
    vi.mocked(prisma.rule.findMany).mockResolvedValue([
      {
        id: "rule-1",
        systemType: "TO_REPLY",
        actions: [{ id: "action-1", type: "LABEL", labelId: "label-to-reply" }],
      },
      {
        id: "rule-2",
        systemType: "AWAITING_REPLY",
        actions: [
          { id: "action-2", type: "LABEL", labelId: "label-awaiting-reply" },
        ],
      },
      {
        id: "rule-3",
        systemType: "FYI",
        actions: [{ id: "action-3", type: "LABEL", labelId: "label-fyi" }],
      },
      {
        id: "rule-4",
        systemType: "ACTIONED",
        actions: [{ id: "action-4", type: "LABEL", labelId: "label-actioned" }],
      },
    ] as any);

    vi.mocked(mockProvider.getLabels).mockResolvedValue([
      { id: "label-to-reply", name: TO_REPLY, type: "user" },
      { id: "label-awaiting-reply", name: AWAITING_REPLY, type: "user" },
      { id: "label-actioned", name: ACTIONED, type: "user" },
    ]);
    vi.mocked(mockProvider.getLabelById).mockImplementation(async (labelId) =>
      labelId === "label-fyi"
        ? { id: "label-fyi", name: FYI, type: "user" }
        : null,
    );

    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "ACTIONED",
      provider: mockProvider,
      logger,
    });

    expect(mockProvider.removeThreadLabels).toHaveBeenCalledWith(
      threadId,
      expect.arrayContaining([
        "label-to-reply",
        "label-awaiting-reply",
        "label-fyi",
      ]),
    );
  });

  test("creates label when not found in DB or provider labels", async () => {
    // Mock prisma to return empty rules for target label
    vi.mocked(prisma.rule.findMany).mockResolvedValue([
      {
        id: "rule-2",
        systemType: "AWAITING_REPLY",
        actions: [
          {
            id: "action-2",
            type: "LABEL",
            labelId: "label-awaiting-reply",
            label: null,
          },
        ],
      },
      {
        id: "rule-3",
        systemType: "FYI",
        actions: [
          { id: "action-3", type: "LABEL", labelId: "label-fyi", label: null },
        ],
      },
      {
        id: "rule-4",
        systemType: "ACTIONED",
        actions: [
          {
            id: "action-4",
            type: "LABEL",
            labelId: "label-actioned",
            label: null,
          },
        ],
      },
    ] as any);

    // Mock provider labels without TO_REPLY
    vi.mocked(mockProvider.getLabels).mockResolvedValue([
      { id: "label-awaiting-reply", name: AWAITING_REPLY, type: "user" },
      { id: "label-fyi", name: FYI, type: "user" },
      { id: "label-actioned", name: ACTIONED, type: "user" },
    ]);

    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "TO_REPLY",
      provider: mockProvider,
      logger,
    });

    // Should have created the label
    expect(mockProvider.createLabel).toHaveBeenCalledWith(TO_REPLY);

    // Should use the newly created label ID
    expect(mockProvider.labelMessage).toHaveBeenCalledWith({
      messageId,
      labelId: "label-to-reply",
      labelName: TO_REPLY,
    });
  });

  test("handles label creation failure gracefully", async () => {
    // Mock prisma to return empty rules for target label
    vi.mocked(prisma.rule.findMany).mockResolvedValue([] as any);

    // Mock provider labels to be empty (no conflicting labels to remove)
    vi.mocked(mockProvider.getLabels).mockResolvedValue([]);

    // Mock createLabel to return null
    vi.mocked(mockProvider.createLabel).mockResolvedValue(null as any);

    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "TO_REPLY",
      provider: mockProvider,
      logger,
    });

    // Should NOT call removeThreadLabels since there are no conflicting labels
    expect(mockProvider.removeThreadLabels).not.toHaveBeenCalled();

    // Should not call labelMessage since label creation failed
    expect(mockProvider.labelMessage).not.toHaveBeenCalled();
  });

  test("finishes removing conflicting labels before adding the target label", async () => {
    // Outlook rewrites a message's full category list, so overlapping writes
    // to the same message conflict or drop each other's changes.
    const calls: string[] = [];
    vi.mocked(mockProvider.removeThreadLabels).mockImplementation(async () => {
      calls.push("remove:start");
      await new Promise((resolve) => setTimeout(resolve, 0));
      calls.push("remove:end");
    });
    vi.mocked(mockProvider.labelMessage).mockImplementation(async () => {
      calls.push("add");
      return {};
    });

    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "FYI",
      provider: mockProvider,
      logger,
    });

    expect(calls).toEqual(["remove:start", "remove:end", "add"]);
  });

  test("removes exactly 3 labels (all except target)", async () => {
    await applyThreadStatusLabel({
      emailAccountId,
      threadId,
      messageId,
      systemType: "FYI",
      provider: mockProvider,
      logger,
    });

    const removeCall = vi.mocked(mockProvider.removeThreadLabels).mock.calls[0];

    // Should remove exactly 3 labels (all 4 conversation statuses minus the target)
    expect(removeCall[1]).toHaveLength(3);
  });
});
