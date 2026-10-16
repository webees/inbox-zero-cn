import {
  ArchiveIcon,
  ForwardIcon,
  KeyboardIcon,
  PenLineIcon,
  StarIcon,
  type LucideIcon,
} from "lucide-react";
import type { Command, CommandSection } from "@/lib/commands/types";
import { createClientLogger } from "@/utils/logger-client";

const logger = createClientLogger("shortcuts");

/**
 * `global` bindings are active anywhere the app mounts a `ShortcutsProvider`.
 * `mail` bindings are only active where the mail scope is enabled, so they are
 * inert on the rest of the app.
 */
export type ShortcutScope = "global" | "mail";

/** Every surface that binds mail keys also needs the global ones. */
export const MAIL_SHORTCUT_SCOPES: readonly ShortcutScope[] = [
  "global",
  "mail",
];

/** Display order of the `?` help dialog sections. */
export const SHORTCUT_GROUPS = [
  "Navigate",
  "Triage",
  "View",
  "Compose",
  "Assistant & rules",
] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/** `g` then `a`: the second key has to land inside this window. */
export const SEQUENCE_TIMEOUT_MS = 900;

/** react-hotkeys-hook's sequence separator: `g>a` is "press g, then a". */
export const SEQUENCE_SPLIT_KEY = ">";

export type ShortcutHandler = (event?: KeyboardEvent) => void;

export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

type ShortcutPalette = {
  section: CommandSection;
  description?: string;
  keywords?: readonly string[];
  priority?: number;
  icon?: LucideIcon;
};

export type ShortcutEntry = {
  id: string;
  /**
   * react-hotkeys-hook hotkey strings, matched against `event.key` so they
   * follow the character the user typed rather than the physical key.
   */
  keys: readonly string[];
  scope: ShortcutScope;
  group: ShortcutGroup;
  label: string;
  /** Overrides the keys rendered in the help dialog and the palette. */
  display?: readonly string[];
  /** Fires even while typing. Only for modifier combos and Escape. */
  allowWhileTyping?: boolean;
  /** Only available in the Electron shell, never in a browser tab. */
  desktopOnly?: boolean;
  /** Handles the key before rich text editors can consume it. */
  capture?: boolean;
  /** Present means the entry shows in ⌘K once a handler is registered. */
  palette?: ShortcutPalette;
  /** Fallback when no handler is injected at the call site. */
  action?: ShortcutHandler;
};

const SHORTCUT_DEFINITIONS = [
  {
    id: "unsubscribe",
    keys: ["shift+u"],
    scope: "mail",
    group: "Triage",
    label: "退订或拦截发件人",
  },
  {
    id: "toggleAutoArchive",
    keys: ["shift+e"],
    scope: "mail",
    group: "Triage",
    label: "切换该发件人的自动归档",
  },
  {
    id: "next",
    keys: ["j", "arrowdown"],
    scope: "mail",
    group: "Navigate",
    label: "下一条消息",
  },
  {
    id: "previous",
    keys: ["k", "arrowup"],
    scope: "mail",
    group: "Navigate",
    label: "上一条消息",
  },
  {
    id: "open",
    keys: ["enter"],
    scope: "mail",
    group: "Navigate",
    label: "打开消息",
  },
  {
    id: "backToList",
    keys: ["escape"],
    scope: "mail",
    group: "Navigate",
    label: "返回列表",
    allowWhileTyping: true,
  },
  {
    id: "nextSplit",
    keys: ["tab"],
    scope: "mail",
    group: "Navigate",
    label: "下一个分栏",
  },
  {
    id: "switchAccount",
    keys: [
      "mod+1",
      "mod+2",
      "mod+3",
      "mod+4",
      "mod+5",
      "mod+6",
      "mod+7",
      "mod+8",
      "mod+9",
    ],
    display: ["modorctrl+1–9"],
    scope: "mail",
    group: "Navigate",
    label: "切换账号",
    allowWhileTyping: true,
    desktopOnly: true,
  },
  {
    id: "switchAllAccounts",
    keys: ["mod+0"],
    display: ["modorctrl+0"],
    scope: "mail",
    group: "Navigate",
    label: "所有账号",
    allowWhileTyping: true,
    desktopOnly: true,
  },
  {
    id: "backToApp",
    keys: ["g>a"],
    scope: "mail",
    group: "Navigate",
    label: "返回应用",
  },
  {
    id: "openExternal",
    keys: ["g>g"],
    scope: "mail",
    group: "Navigate",
    label: "在邮箱服务商中打开",
  },
  {
    id: "commandPalette",
    keys: ["mod+k"],
    scope: "global",
    group: "Navigate",
    label: "命令面板",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "search",
    keys: ["/"],
    scope: "mail",
    group: "Navigate",
    label: "搜索",
  },
  {
    id: "select",
    keys: ["x"],
    scope: "mail",
    group: "Triage",
    label: "选择",
  },
  {
    id: "selectAll",
    keys: ["mod+a"],
    scope: "mail",
    group: "Triage",
    label: "全选",
  },
  {
    id: "extendSelectionDown",
    keys: ["shift+arrowdown", "shift+j"],
    scope: "mail",
    group: "Triage",
    label: "向下扩展选择",
  },
  {
    id: "extendSelectionUp",
    keys: ["shift+arrowup", "shift+k"],
    scope: "mail",
    group: "Triage",
    label: "向上扩展选择",
  },
  {
    id: "archive",
    keys: ["e"],
    scope: "mail",
    group: "Triage",
    label: "归档",
    palette: {
      section: "actions",
      description: "归档当前邮件",
      keywords: ["archive", "remove", "delete"],
      priority: 0,
      icon: ArchiveIcon,
    },
  },
  {
    id: "star",
    keys: ["s"],
    scope: "mail",
    group: "Triage",
    label: "加星标 / 取消星标",
    palette: {
      section: "actions",
      keywords: ["star", "unstar"],
      icon: StarIcon,
    },
  },
  {
    id: "label",
    keys: ["l"],
    scope: "mail",
    group: "Triage",
    label: "标签",
  },
  {
    id: "markUnread",
    keys: ["u"],
    scope: "mail",
    group: "Triage",
    label: "标记为未读",
  },
  {
    id: "move",
    keys: ["v"],
    scope: "mail",
    group: "Triage",
    label: "移动",
  },
  {
    // `!` sits behind shift on US layouts and in front of it on others.
    id: "markSpam",
    keys: ["shift+!", "!"],
    display: ["!"],
    scope: "mail",
    group: "Triage",
    label: "标记为垃圾邮件",
  },
  {
    id: "snooze",
    keys: ["h"],
    scope: "mail",
    group: "Triage",
    label: "稍后处理",
  },
  {
    // `#` sits behind shift on US layouts and in front of it on others.
    id: "delete",
    keys: ["shift+#", "#", "backspace"],
    display: ["#"],
    scope: "mail",
    group: "Triage",
    label: "删除",
  },
  {
    id: "reply",
    keys: ["r"],
    scope: "mail",
    group: "Triage",
    label: "回复",
  },
  {
    id: "replyAll",
    keys: ["a"],
    scope: "mail",
    group: "Triage",
    label: "全部回复",
  },
  {
    id: "forward",
    keys: ["f"],
    scope: "mail",
    group: "Triage",
    label: "转发",
    palette: {
      section: "actions",
      keywords: ["forward", "send", "share"],
      priority: 4,
      icon: ForwardIcon,
    },
  },
  {
    id: "moreActions",
    keys: ["."],
    scope: "mail",
    group: "Triage",
    label: "更多操作",
  },
  {
    id: "openTeamComments",
    keys: ["m"],
    scope: "mail",
    group: "View",
    label: "评论",
  },
  {
    id: "undo",
    keys: ["z"],
    scope: "mail",
    group: "Triage",
    label: "撤销上一个操作",
  },
  {
    id: "translate",
    keys: ["shift+t"],
    scope: "mail",
    group: "View",
    label: "翻译 / 显示原文",
  },
  {
    id: "toggleLayout",
    keys: ["shift+v"],
    scope: "mail",
    group: "View",
    label: "列表视图 / 分栏视图",
  },
  {
    id: "togglePreview",
    keys: ["shift+p"],
    scope: "mail",
    group: "View",
    label: "简短 / 展开预览文本",
  },
  {
    id: "help",
    keys: ["shift+?", "?"],
    display: ["?"],
    scope: "mail",
    group: "View",
    label: "键盘快捷键",
    palette: {
      section: "settings",
      keywords: ["shortcuts", "keyboard", "hotkeys", "help"],
      icon: KeyboardIcon,
    },
  },
  {
    id: "compose",
    keys: ["c"],
    scope: "global",
    group: "Compose",
    label: "新邮件",
    palette: {
      section: "actions",
      keywords: ["compose", "write", "email"],
      priority: 20,
      icon: PenLineIcon,
    },
  },
  {
    id: "send",
    keys: ["mod+enter"],
    scope: "mail",
    group: "Compose",
    label: "发送",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "sendAndMarkDone",
    keys: ["mod+shift+enter"],
    scope: "mail",
    group: "Compose",
    label: "发送并标记完成",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "sendLater",
    keys: ["mod+shift+l"],
    scope: "mail",
    group: "Compose",
    label: "稍后发送",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "remindMe",
    keys: ["mod+shift+h"],
    scope: "mail",
    group: "Compose",
    label: "提醒我",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "attachFiles",
    keys: ["mod+shift+u"],
    scope: "mail",
    group: "Compose",
    label: "添加附件",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "popOutDraft",
    keys: ["mod+shift+p"],
    scope: "mail",
    group: "Compose",
    label: "弹出草稿",
    allowWhileTyping: true,
    capture: true,
  },
  {
    id: "discardDraft",
    keys: ["mod+shift+,", "mod+shift+<"],
    display: ["mod+shift+,"],
    scope: "mail",
    group: "Compose",
    label: "丢弃草稿",
    allowWhileTyping: true,
    capture: true,
  },
] as const satisfies readonly ShortcutEntry[];

export type ShortcutId = (typeof SHORTCUT_DEFINITIONS)[number]["id"];

/** The single source of truth behind key handling, `?` help and ⌘K. */
export const SHORTCUTS: readonly ShortcutEntry[] = SHORTCUT_DEFINITIONS;

const SHORTCUTS_BY_ID = new Map(SHORTCUTS.map((entry) => [entry.id, entry]));

export type ShortcutConflict = {
  key: string;
  ids: string[];
};

type ShortcutKeyOwner = {
  id: string;
  scope: ShortcutScope;
  viaPrefix: boolean;
};

export function getShortcut(id: ShortcutId): ShortcutEntry {
  const entry = SHORTCUTS_BY_ID.get(id);
  if (!entry) throw new Error(`Unknown shortcut: ${id}`);
  return entry;
}

export function getShortcutsForScopes(
  scopes: readonly ShortcutScope[],
  { isDesktopApp = false }: { isDesktopApp?: boolean } = {},
): ShortcutEntry[] {
  return SHORTCUTS.filter(
    (entry) =>
      scopes.includes(entry.scope) && (!entry.desktopOnly || isDesktopApp),
  );
}

/** Feeds the `?` help dialog so it can never drift from the handlers. */
export function getShortcutGroups(
  scopes: readonly ShortcutScope[],
  options: { isDesktopApp?: boolean } = {},
): { group: ShortcutGroup; shortcuts: ShortcutEntry[] }[] {
  const entries = getShortcutsForScopes(scopes, options);

  return SHORTCUT_GROUPS.map((group) => ({
    group,
    shortcuts: entries.filter((entry) => entry.group === group),
  })).filter(({ shortcuts }) => shortcuts.length > 0);
}

/** The keys as shown to the user, e.g. `⌘K`, `J / ↓`, `G A`. */
export function formatShortcutKeys(entry: ShortcutEntry): string {
  const keys = entry.display ?? entry.keys;
  return keys.map(formatKey).join(" / ");
}

export function getShortcutHint(id: ShortcutId): string {
  return formatShortcutKeys(getShortcut(id));
}

/**
 * One label per key of the first binding, e.g. `["⌘", "shift", "enter"]`, for
 * surfaces that render a key per block. Modifiers are spelled out because the
 * stacked symbols (`⌘⇧↵`) are unreadable at tooltip size.
 */
export function getShortcutKeyLabels(id: ShortcutId): string[] {
  const entry = getShortcut(id);
  const [binding] = entry.display ?? entry.keys;

  return binding
    .split(SEQUENCE_SPLIT_KEY)
    .flatMap((step) => step.split("+"))
    .map((token) => formatKeyToken(token, true));
}

/** Feeds ⌘K: an entry appears once its handler is registered. */
export function buildShortcutPaletteCommands(
  handlers: ShortcutHandlers,
): Command[] {
  const commands: (Command & { priority: number })[] = [];

  for (const entry of SHORTCUTS) {
    const palette = entry.palette;
    if (!palette) continue;

    const handler = handlers[entry.id as ShortcutId] ?? entry.action;
    if (!handler) continue;

    commands.push({
      id: entry.id,
      label: entry.label,
      description: palette.description,
      icon: palette.icon,
      shortcut: formatShortcutKeys(entry),
      section: palette.section,
      priority: palette.priority ?? 50,
      keywords: palette.keywords ? [...palette.keywords] : undefined,
      action: () => handler(),
    });
  }

  return commands.sort((a, b) => a.priority - b.priority);
}

/**
 * Two entries owning the same key fire both handlers. Scopes that are never
 * active together are allowed to reuse a key; `global` is active alongside
 * everything, so it never can.
 */
export function findShortcutConflicts(
  entries: readonly ShortcutEntry[],
): ShortcutConflict[] {
  const owners = new Map<string, ShortcutKeyOwner[]>();

  for (const entry of entries) {
    for (const key of entry.keys) {
      addOwner(owners, key, entry, false);
      // Reserve the sequence prefix: a plain `g` binding would swallow `g>a`.
      const [prefix] = key.split(SEQUENCE_SPLIT_KEY);
      if (prefix !== key) addOwner(owners, prefix, entry, true);
    }
  }

  const conflicts: ShortcutConflict[] = [];

  for (const [key, keyOwners] of owners) {
    const clashing = keyOwners.filter((owner) =>
      keyOwners.some(
        (other) =>
          other.id !== owner.id &&
          scopesOverlap(owner.scope, other.scope) &&
          // Two sequences may share a prefix (`g>a` and `g>i`).
          !(owner.viaPrefix && other.viaPrefix),
      ),
    );
    if (clashing.length > 1) {
      conflicts.push({ key, ids: clashing.map((owner) => owner.id) });
    }
  }

  return conflicts;
}

export function assertNoShortcutConflicts(
  entries: readonly ShortcutEntry[],
): void {
  const conflicts = findShortcutConflicts(entries);
  if (conflicts.length === 0) return;
  throw new Error(`Conflicting shortcuts: ${describeConflicts(conflicts)}`);
}

/** Bindings stay inert while the user is typing, unless they're a ⌘ combo. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;

  const tagName = element.tagName.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (element.isContentEditable) return true;
  if (element.getAttribute?.("role") === "textbox") return true;

  return !!element.closest?.(
    "[contenteditable]:not([contenteditable='false'])",
  );
}

/**
 * Tracks a pending sequence prefix (`g`) so the plain binding for the second
 * key (`a` = reply all) stays quiet while a sequence is in flight.
 */
export function createSequencePrefixTracker(now: () => number = Date.now) {
  let prefix: string | null = null;
  let startedAt = 0;
  let resolvedBy: KeyboardEvent | null = null;

  return {
    start(key: string) {
      prefix = key;
      startedAt = now();
      resolvedBy = null;
    },
    pendingPrefix(): string | null {
      if (prefix && now() - startedAt >= SEQUENCE_TIMEOUT_MS) prefix = null;
      return prefix;
    },
    /**
     * A completed sequence and the plain binding for its last key are matched
     * by the same event, in an order we do not control.
     */
    resolve(event: KeyboardEvent) {
      prefix = null;
      resolvedBy = event;
    },
    wasResolvedBy(event: KeyboardEvent): boolean {
      return resolvedBy === event;
    },
    clear() {
      prefix = null;
    },
  };
}

// A conflicting registry is a bug, not a runtime condition: fail loudly while
// developing, and report it rather than crash a production session.
if (process.env.NODE_ENV === "production") {
  const conflicts = findShortcutConflicts(SHORTCUTS);
  if (conflicts.length > 0) {
    logger.error("快捷键冲突", {
      conflicts: describeConflicts(conflicts),
    });
  }
} else {
  assertNoShortcutConflicts(SHORTCUTS);
}

const KEY_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  meta: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  enter: "↵",
  escape: "Esc",
  tab: "Tab",
  backspace: "⌫",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Overrides `KEY_SYMBOLS` where a word reads better than a symbol. */
const KEY_WORDS: Record<string, string> = {
  ctrl: "ctrl",
  alt: "option",
  shift: "shift",
  enter: "enter",
  escape: "esc",
  tab: "tab",
  backspace: "delete",
  space: "space",
};

function formatKey(key: string): string {
  return key
    .split(SEQUENCE_SPLIT_KEY)
    .map((step) =>
      step
        .split("+")
        .map((token) => formatKeyToken(token))
        .join(""),
    )
    .join(" ");
}

function formatKeyToken(token: string, spelledOut = false): string {
  if (token === "modorctrl") {
    const isMac =
      typeof window === "undefined" ||
      /Mac|iPhone|iPod|iPad/.test(window.navigator.userAgent);

    if (isMac) return "⌘";
    return spelledOut ? "Ctrl" : "Ctrl+";
  }

  return (
    (spelledOut ? KEY_WORDS[token] : undefined) ??
    KEY_SYMBOLS[token] ??
    token.toUpperCase()
  );
}

function addOwner(
  owners: Map<string, ShortcutKeyOwner[]>,
  key: string,
  entry: ShortcutEntry,
  viaPrefix: boolean,
) {
  const existing = owners.get(key);
  if (viaPrefix && existing?.some((owner) => owner.id === entry.id)) return;

  const owner = { id: entry.id, scope: entry.scope, viaPrefix };
  if (existing) existing.push(owner);
  else owners.set(key, [owner]);
}

function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === b || a === "global" || b === "global";
}

function describeConflicts(conflicts: ShortcutConflict[]): string {
  return conflicts
    .map(({ key, ids }) => `${key} (${ids.join(", ")})`)
    .join("; ");
}
