// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveProgress } from "./ArchiveProgress";

const mockUseArchiveQueueProgress = vi.fn();
const mockClearArchiveSenderStatuses = vi.fn();
vi.mock("@/store/archive-sender-queue", () => ({
  clearArchiveSenderStatuses: (
    ...args: Parameters<typeof mockClearArchiveSenderStatuses>
  ) => mockClearArchiveSenderStatuses(...args),
  useArchiveQueueProgress: (
    ...args: Parameters<typeof mockUseArchiveQueueProgress>
  ) => mockUseArchiveQueueProgress(...args),
}));

vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({ emailAccountId: "account-1" }),
}));

describe("ArchiveProgress", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockUseArchiveQueueProgress.mockReturnValue(undefined);
  });

  it("renders durable sender archive progress", () => {
    mockUseArchiveQueueProgress.mockReturnValue({
      activeItems: 2,
      totalItems: 3,
      completedItems: 1,
      failedItems: 0,
      settledItems: 1,
    });
    render(<ArchiveProgress />);

    expect(screen.getByText("正在归档发件人…")).toBeTruthy();
    expect(screen.getByText("1 of 3 发件人 processed")).toBeTruthy();
  });

  it("settles failed work without presenting it as successful", () => {
    mockUseArchiveQueueProgress.mockReturnValue({
      activeItems: 0,
      totalItems: 3,
      completedItems: 2,
      failedItems: 1,
      settledItems: 3,
    });
    render(<ArchiveProgress />);

    expect(screen.getByText("归档完成：2 个成功，1 个失败。")).toBeTruthy();
    expect(screen.getByText("3 of 3 发件人 processed")).toBeTruthy();
  });

  it("clears completed account progress after it has been shown", async () => {
    vi.useFakeTimers();
    mockUseArchiveQueueProgress.mockReturnValue({
      activeItems: 0,
      totalItems: 3,
      completedItems: 3,
      failedItems: 0,
      settledItems: 3,
    });
    render(<ArchiveProgress />);

    await vi.advanceTimersByTimeAsync(3000);

    expect(mockClearArchiveSenderStatuses).toHaveBeenCalledWith("account-1");
  });

  it("stays hidden without a durable sender batch", () => {
    const { container } = render(<ArchiveProgress />);
    expect(container.firstChild).toBeNull();
  });
});
