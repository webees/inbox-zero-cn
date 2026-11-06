/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/actions/assistant-chat", () => ({
  confirmAssistantCreateRule: vi.fn(),
  confirmAssistantEmailAction: vi.fn(),
  confirmAssistantSaveMemory: vi.fn(),
}));
vi.mock("@/utils/actions/rule", () => ({
  deleteRuleAction: vi.fn(),
  toggleRuleAction: vi.fn(),
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: vi.fn(),
}));
vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: vi.fn(),
}));
vi.mock("@/providers/ChatProvider", () => ({
  useChat: vi.fn(),
}));
vi.mock("nuqs", () => ({
  useQueryState: vi.fn(),
}));
vi.mock("@/app/(app)/[emailAccountId]/assistant/RuleDialog", () => ({
  RuleDialog: () => null,
}));
vi.mock("@/hooks/useDialogState", () => ({
  useDialogState: vi.fn(),
}));
vi.mock("@/components/assistant-chat/inline-email-card", () => ({
  InlineEmailCard: () => null,
}));

import { SearchInboxResult } from "@/components/assistant-chat/tools";

describe("SearchInboxResult", () => {
  it("renders search failures inside the collapsible search card instead of a raw error card", () => {
    render(
      <SearchInboxResult
        outputs={[
          {
            queryUsed: "from:sender@example.com",
            error: "Failed to search inbox",
          },
        ]}
      />,
    );

    expect(screen.queryByText("Error: Failed to search inbox")).toBeNull();
    expect(screen.getByText("搜索收件箱")).toBeTruthy();
    expect(screen.queryByText("该请求的搜索结果不可用。")).toBeNull();

    fireEvent.click(screen.getByText("搜索收件箱"));

    expect(screen.getByText("该请求的搜索结果不可用。")).toBeTruthy();
    expect(screen.getByText("Failed to search inbox")).toBeTruthy();
    expect(screen.getByText("from:sender@example.com")).toBeTruthy();
  });

  it("merges consecutive searches into one row that lists every query", () => {
    render(
      <SearchInboxResult
        outputs={[
          { queryUsed: "from:cursor.sh", messages: [] },
          { queryUsed: "from:x.ai", messages: [] },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("搜索收件箱 ×2"));

    expect(screen.getByText("from:cursor.sh")).toBeTruthy();
    expect(screen.getByText("from:x.ai")).toBeTruthy();
  });
});
