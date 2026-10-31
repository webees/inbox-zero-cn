import { describe, expect, it } from "vitest";
import { ActionType, MessagingProvider } from "@/generated/prisma/enums";
import { getActionDisplay } from "@/utils/action-display";

describe("getActionDisplay", () => {
  it.each([
    [MessagingProvider.SLACK, "通知 Slack"],
    [MessagingProvider.TEAMS, "通知 Teams"],
    [MessagingProvider.TELEGRAM, "通知 Telegram"],
  ])("shows the notification provider for %s", (provider, expected) => {
    expect(
      getActionDisplay(
        {
          type: ActionType.NOTIFY_MESSAGING_CHANNEL,
          messagingChannel: { provider },
        },
        "gmail",
        [],
      ),
    ).toBe(expected);
  });

  it("keeps a generic fallback when the messaging channel is missing", () => {
    expect(
      getActionDisplay(
        { type: ActionType.NOTIFY_MESSAGING_CHANNEL },
        "gmail",
        [],
      ),
    ).toBe("通知");
  });
});
