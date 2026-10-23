import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { buildDesktopContextMenuTemplate } from "./context-menu";

vi.mock("electron", () => ({}));

describe("desktop context menu", () => {
  it("offers copy and lookup for text selected in an email", () => {
    const actions = createActions();
    const template = build({ selectionText: "quarterly numbers" }, actions);

    expect(labels(template)).toEqual([
      "查询 “quarterly numbers”",
      "使用 Google 搜索 “quarterly numbers”",
      "---",
      "copy",
      "---",
      "shareMenu",
      "语音",
    ]);

    click(template, "使用 Google 搜索 “quarterly numbers”");
    expect(actions.openExternal).toHaveBeenCalledWith(
      "https://www.google.com/search?q=quarterly%20numbers",
    );
  });

  it("leaves out macOS-only items on Windows", () => {
    const template = build(
      { selectionText: "hello" },
      createActions(),
      "win32",
    );

    expect(labels(template)).toEqual([
      "使用 Google 搜索 “hello”",
      "---",
      "copy",
    ]);
  });

  it("offers spelling suggestions and editing commands in the composer", () => {
    const actions = createActions();
    const template = build(
      {
        isEditable: true,
        misspelledWord: "recieve",
        dictionarySuggestions: ["receive", "relieve"],
        editFlags: editFlags({ canCopy: false }),
      },
      actions,
    );

    expect(labels(template)).toEqual([
      "receive",
      "relieve",
      "添加到词典",
      "---",
      "cut",
      "copy",
      "paste",
      "pasteAndMatchStyle",
      "selectAll",
      "---",
      "表情符号与符号",
    ]);
    expect(template.find((item) => item.role === "copy")?.enabled).toBe(false);

    click(template, "receive");
    expect(actions.replaceMisspelling).toHaveBeenCalledWith("receive");
    click(template, "添加到词典");
    expect(actions.addToDictionary).toHaveBeenCalledWith("recieve");
  });

  it("copies the bare address from a mailto link", () => {
    const actions = createActions();
    const template = build(
      { linkURL: "mailto:jane%2Bnews@example.com?subject=Hi" },
      actions,
    );

    expect(labels(template)).toEqual(["复制邮箱地址"]);
    click(template, "复制邮箱地址");
    expect(actions.copyText).toHaveBeenCalledWith("jane+news@example.com");
  });

  it("falls back to the raw address when a mailto link is malformed", () => {
    const actions = createActions();
    const template = build({ linkURL: "mailto:a%ZZ@example.com" }, actions);

    click(template, "复制邮箱地址");
    expect(actions.copyText).toHaveBeenCalledWith("a%ZZ@example.com");
  });

  it("opens and copies web links", () => {
    const actions = createActions();
    const template = build({ linkURL: "https://example.com/a" }, actions);

    expect(labels(template)).toEqual(["在浏览器中打开链接", "复制链接"]);
    click(template, "在浏览器中打开链接");
    expect(actions.openExternal).toHaveBeenCalledWith("https://example.com/a");
  });

  it("ignores links with unsupported protocols", () => {
    const template = build({ linkURL: "javascript:alert(1)" }, createActions());

    expect(template).toEqual([]);
  });

  it("saves and copies images, without an address for inline data", () => {
    const actions = createActions();
    const remote = build(
      {
        mediaType: "image",
        hasImageContents: true,
        srcURL: "https://example.com/logo.png",
        x: 10,
        y: 20,
      },
      actions,
    );
    expect(labels(remote)).toEqual(["图像另存为…", "复制图像", "复制图像地址"]);
    click(remote, "复制图像");
    expect(actions.copyImageAt).toHaveBeenCalledWith(10, 20);

    const inline = build(
      {
        mediaType: "image",
        hasImageContents: true,
        srcURL: "data:image/png;base64,AAAA",
      },
      actions,
    );
    expect(labels(inline)).toEqual(["图像另存为…", "复制图像"]);
  });

  it("shows nothing on empty space in production", () => {
    expect(build({}, createActions())).toEqual([]);
  });

  it("adds Inspect Element in development", () => {
    const template = buildDesktopContextMenuTemplate(
      params({}),
      createActions(),
      { platform: "darwin", isDevelopment: true },
    );

    expect(labels(template)).toEqual(["检查元素"]);
  });
});

function build(
  overrides: Partial<Parameters<typeof buildDesktopContextMenuTemplate>[0]>,
  actions: ReturnType<typeof createActions>,
  platform: NodeJS.Platform = "darwin",
) {
  return buildDesktopContextMenuTemplate(params(overrides), actions, {
    platform,
    isDevelopment: false,
  });
}

function params(
  overrides: Partial<Parameters<typeof buildDesktopContextMenuTemplate>[0]>,
): Parameters<typeof buildDesktopContextMenuTemplate>[0] {
  return {
    x: 0,
    y: 0,
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    hasImageContents: false,
    isEditable: false,
    selectionText: "",
    misspelledWord: "",
    dictionarySuggestions: [],
    editFlags: editFlags(),
    ...overrides,
  };
}

function editFlags(
  overrides: Partial<
    Parameters<typeof buildDesktopContextMenuTemplate>[0]["editFlags"]
  > = {},
) {
  return {
    canUndo: true,
    canRedo: true,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canDelete: true,
    canSelectAll: true,
    canEditRichly: true,
    ...overrides,
  };
}

function createActions() {
  return {
    copyText: vi.fn(),
    copyImageAt: vi.fn(),
    saveUrl: vi.fn(),
    openExternal: vi.fn(),
    lookUpSelection: vi.fn(),
    replaceMisspelling: vi.fn(),
    addToDictionary: vi.fn(),
    showEmojiPanel: vi.fn(),
    inspectElementAt: vi.fn(),
  };
}

function labels(template: MenuItemConstructorOptions[]) {
  return template.map((item) =>
    item.type === "separator" ? "---" : (item.label ?? item.role),
  );
}

function click(template: MenuItemConstructorOptions[], label: string) {
  template
    .find((item) => item.label === label)
    ?.click?.({} as never, {} as never, {} as never);
}
