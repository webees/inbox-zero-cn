/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailSidebar, type MailSidebarProps } from "./MailSidebar";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onNavigate,
    ...props
  }: React.ComponentProps<"a"> & { onNavigate?: () => void }) => (
    <a href={href} onClick={() => onNavigate?.()} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));

afterEach(cleanup);

function sidebar(overrides: Partial<MailSidebarProps> = {}) {
  return (
    <MailSidebar
      activeType="inbox"
      activeLabelId={null}
      activeFolderId={null}
      hrefFor={(target) =>
        target.kind === "type" ? `/mail?type=${target.type}` : "/mail"
      }
      labels={[]}
      folders={[]}
      countsById={new Map()}
      categories={[]}
      categoryHeading="Categories"
      labelsHeading="Labels"
      labelSingular="label"
      backToAppHref="/automation"
      onNavigate={vi.fn()}
      onCompose={vi.fn()}
      onCreateLabel={vi.fn()}
      onEditMailboxItem={vi.fn()}
      onDeleteMailboxItem={vi.fn()}
      labelEditMode="name-and-color"
      labelColorOptions={[]}
      {...overrides}
    />
  );
}

function renderSidebar(overrides: Partial<MailSidebarProps> = {}) {
  return render(sidebar(overrides));
}

describe("MailSidebar", () => {
  it("reports a click on the row for the view that's already open", () => {
    const onNavigate = vi.fn();
    renderSidebar({ activeType: "inbox", onNavigate });

    fireEvent.click(screen.getByText("收件箱"));

    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("leaves the inbox out in the open and everything else behind Mail", () => {
    renderSidebar();

    expect(screen.getByText("收件箱").closest("a")?.getAttribute("href")).toBe(
      "/mail?type=inbox",
    );
    expect(screen.queryByText("已发送")).toBeNull();

    fireEvent.click(screen.getByText("邮件"));

    expect(
      [
        "草稿",
        "已发送",
        "已归档",
        "已加星标",
        "已定时",
        "垃圾邮件",
        "回收站",
      ].map((name) =>
        screen.getByText(name).closest("a")?.getAttribute("href"),
      ),
    ).toEqual([
      "/mail?type=draft",
      "/mail?type=sent",
      "/mail?type=archive",
      "/mail?type=starred",
      "/mail?type=scheduled",
      "/mail?type=spam",
      "/mail?type=trash",
    ]);
  });

  it("opens the Mail group when one of its views is showing", () => {
    renderSidebar({ activeType: "trash" });

    expect(
      screen.getByText("回收站").closest("a")?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps the active view reachable in the icon rail", () => {
    renderSidebar({ activeType: "trash", collapsed: true });

    expect(screen.getByText("回收站").closest("a")?.getAttribute("href")).toBe(
      "/mail?type=trash",
    );
  });

  it("leaves the Mail group out of the icon rail for other views", () => {
    // 图标栏中没有任何东西能切换分组，因此一行只有在自己的
    // 视图打开时才在栏中占据位置。
    renderSidebar({ activeType: "inbox", collapsed: true });

    expect(screen.queryByText("回收站")).toBeNull();
  });

  it("closes the Mail group in the rail once its view is left behind", () => {
    const { rerender } = renderSidebar({
      activeType: "trash",
      collapsed: true,
    });

    expect(screen.getByText("回收站")).toBeDefined();

    // 图标栏没有回到外面的方式，因此分组不能比它的视图存活更久。
    rerender(sidebar({ activeType: "inbox", collapsed: true }));

    expect(screen.queryByText("回收站")).toBeNull();
  });

  it("keeps a chosen Mail group open across navigation when expanded", () => {
    const { rerender } = renderSidebar({ activeType: "trash" });

    rerender(sidebar({ activeType: "inbox" }));

    expect(screen.getByText("回收站")).toBeDefined();
  });

  it("closes the Categories group in the rail once its view is left behind", () => {
    const categories = [
      { name: "Promotions", type: "CATEGORY_PROMOTIONS", Icon: TagIcon },
    ];
    const { rerender } = renderSidebar({
      activeType: "CATEGORY_PROMOTIONS",
      categories,
      collapsibleCategories: true,
      collapsed: true,
    });

    expect(screen.getByText("Promotions")).toBeDefined();

    rerender(
      sidebar({
        activeType: "inbox",
        categories,
        collapsibleCategories: true,
        collapsed: true,
      }),
    );

    expect(screen.queryByText("Promotions")).toBeNull();
  });

  it("leaves the extra views out of the combined inbox", () => {
    renderSidebar({ unified: true });

    expect(screen.queryByText("邮件")).toBeNull();
    expect(screen.getByText("全部收件箱")).toBeDefined();
  });
});
