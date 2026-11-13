// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleInvitationAction } from "@/utils/actions/organization";
import { AcceptInvitation } from "./AcceptInvitation";

vi.mock("@/utils/actions/organization", () => ({
  handleInvitationAction: vi.fn(),
}));
vi.mock("@/env", () => ({ env: {} }));

describe("AcceptInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("accepts the invitation once and confirms membership", async () => {
    vi.mocked(handleInvitationAction).mockResolvedValue({
      data: { success: true },
    } as never);

    render(<AcceptInvitation invitationId="invite-1" />, {
      reactStrictMode: true,
    });

    expect(await screen.findByText("欢迎！")).toBeTruthy();
    expect(handleInvitationAction).toHaveBeenCalledOnce();
    expect(handleInvitationAction).toHaveBeenCalledWith({
      invitationId: "invite-1",
    });
  });

  it("shows the server's reason when the invitation cannot be accepted", async () => {
    vi.mocked(handleInvitationAction).mockResolvedValue({
      serverError: "此邀请已过期。请让你的组织管理员重新发送一份。",
    } as never);

    render(<AcceptInvitation invitationId="invite-1" />);

    expect(
      await screen.findByText("此邀请已过期。请让你的组织管理员重新发送一份。"),
    ).toBeTruthy();
    expect(screen.queryByText("欢迎！")).toBeNull();
  });
});
