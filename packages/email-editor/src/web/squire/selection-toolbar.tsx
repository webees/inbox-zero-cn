import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type Squire from "squire-rte";
import styles from "../EmailEditor.module.css";
import { FormattingIcon, ToolbarButton } from "../toolbar";
import { placePopover } from "./placement";

export type FormatState = {
  blockquote: boolean;
  bold: boolean;
  bulletList: boolean;
  direction?: "ltr" | "rtl";
  italic: boolean;
  link: boolean;
  orderedList: boolean;
  strike: boolean;
  underline: boolean;
};

export const EMPTY_FORMAT_STATE: FormatState = {
  blockquote: false,
  bold: false,
  bulletList: false,
  italic: false,
  link: false,
  orderedList: false,
  strike: false,
  underline: false,
};

// Provider drafts use either tag for the same formatting.
const MARK_TAGS = {
  bold: ["B", "STRONG"],
  italic: ["I", "EM"],
  strike: ["S", "STRIKE", "DEL"],
  underline: ["U"],
} as const;

export function readFormatState(editor: Squire): FormatState {
  const root = editor.getRoot();
  const range = editor.getSelection();
  const closest = (selector: string) => {
    const node = range.startContainer;
    const element = node instanceof Element ? node : node.parentElement;
    const match = element?.closest(selector);
    return match && root.contains(match) && match !== root ? match : null;
  };
  const list = closest("ul, ol");
  const direction = closest("[dir]")?.getAttribute("dir");

  return {
    blockquote: Boolean(closest("blockquote")),
    bold: hasMark(editor, "bold"),
    bulletList: list?.nodeName === "UL",
    direction:
      direction === "ltr" || direction === "rtl" ? direction : undefined,
    italic: hasMark(editor, "italic"),
    link: editor.hasFormat("A"),
    orderedList: list?.nodeName === "OL",
    strike: hasMark(editor, "strike"),
    underline: hasMark(editor, "underline"),
  };
}

export function SelectionToolbar({
  editor,
  onLink,
  position,
  state,
}: {
  editor: Squire;
  onLink: () => void;
  // Viewport coordinates of the selection; the toolbar is portalled so
  // containers that clip their overflow cannot hide it.
  position: { bottom: number; centerX: number; top: number };
  state: FormatState;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    setPlacement(
      placePopover({
        align: "center",
        anchor: {
          bottom: position.bottom,
          left: position.centerX,
          right: position.centerX,
          top: position.top,
        },
        bounds: {
          bottom: window.innerHeight,
          left: 0,
          right: window.innerWidth,
          top: 0,
        },
        size: {
          height: ref.current?.offsetHeight ?? 0,
          width: ref.current?.offsetWidth ?? 0,
        },
      }),
    );
  }, [position.bottom, position.centerX, position.top]);

  return createPortal(
    <div
      className={styles.squireToolbar}
      ref={ref}
      style={{
        left: placement?.left ?? position.centerX,
        top: placement?.top ?? position.bottom,
        visibility: placement ? undefined : "hidden",
      }}
    >
      <div
        aria-label="选区格式"
        className={styles.bubbleToolbar}
        role="toolbar"
      >
        <ToolbarButton
          active={state.bold}
          label="Bold"
          onPress={() => toggleMark(editor, "bold")}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          active={state.italic}
          label="斜体"
          onPress={() => toggleMark(editor, "italic")}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          active={state.underline}
          label="下划线"
          onPress={() => toggleMark(editor, "underline")}
        >
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton
          active={state.strike}
          label="删除线"
          onPress={() => toggleMark(editor, "strike")}
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          active={state.link}
          label="添加或编辑链接"
          onPress={onLink}
        >
          <FormattingIcon kind="link" />
        </ToolbarButton>
        <span aria-hidden className={styles.separator} />
        <ToolbarButton
          active={state.bulletList}
          label="项目符号列表"
          onPress={() =>
            state.bulletList ? editor.removeList() : editor.makeUnorderedList()
          }
        >
          <FormattingIcon kind="bullets" />
        </ToolbarButton>
        <ToolbarButton
          active={state.orderedList}
          label="编号列表"
          onPress={() =>
            state.orderedList ? editor.removeList() : editor.makeOrderedList()
          }
        >
          <FormattingIcon kind="numbers" />
        </ToolbarButton>
        <ToolbarButton
          active={state.blockquote}
          label="引用"
          onPress={() =>
            state.blockquote
              ? editor.removeQuote()
              : editor.increaseQuoteLevel()
          }
        >
          <FormattingIcon kind="quote" />
        </ToolbarButton>
        <span aria-hidden className={styles.separator} />
        <ToolbarButton
          active={state.direction === "ltr"}
          label="从左到右文字"
          onPress={() => editor.setTextDirection("ltr")}
        >
          <FormattingIcon kind="ltr" />
        </ToolbarButton>
        <ToolbarButton
          active={state.direction === "rtl"}
          label="从右到左文字"
          onPress={() => editor.setTextDirection("rtl")}
        >
          <FormattingIcon kind="rtl" />
        </ToolbarButton>
      </div>
    </div>,
    document.body,
  );
}

function hasMark(editor: Squire, mark: keyof typeof MARK_TAGS) {
  return MARK_TAGS[mark].some((tag) => editor.hasFormat(tag));
}

function toggleMark(editor: Squire, mark: keyof typeof MARK_TAGS) {
  const [tag, ...alternates] = MARK_TAGS[mark];
  if (!hasMark(editor, mark)) {
    editor.changeFormat({ tag });
    return;
  }
  editor.changeFormat(null, { tag });
  for (const alternate of alternates) {
    if (editor.hasFormat(alternate))
      editor.changeFormat(null, { tag: alternate });
  }
}
