"use client";

import { forwardRef, lazy, Suspense, useState } from "react";
import { prepareEmailBodySignatureHtml } from "../core/email-body";
import {
  type EmailBodyMode,
  sanitizePreservedEmailHtmlForPreview,
} from "../core/email-html";
import styles from "./EmailEditor.module.css";

export type EmailEditorValue = {
  editableHtml: string;
  inlineContentIds: string[];
  mode: EmailBodyMode;
  preservedBlockIds: string[];
};

export type EmailEditorState = Omit<EmailEditorValue, "editableHtml">;

export type EmailEditorPreservedBlock = {
  id: string;
  kind: "quote" | "signature";
  html: string;
};

export type EmailEditorSlashTrigger = {
  query: string;
  rect: DOMRect;
};

export type EmailEditorHandle = {
  focus: () => void;
  getSelectedText: () => string;
  getValue: () => EmailEditorValue;
  insertHtml: (html: string) => boolean;
  insertText: (text: string) => boolean;
  // Quotes plain text at the caret on its own lines, leaving the caret on a
  // fresh line below the quote.
  insertQuote: (text: string) => boolean;
  insertInlineImage: (image: {
    alt: string;
    contentId: string;
    previewUrl: string;
  }) => boolean;
  removeInlineImage: (contentId: string) => boolean;
  // 将签名替换为另一个，若原先没有则添加。空 HTML 会移除签名。
  // 邮件其余部分保持原样。
  replaceSignature: (html: string) => boolean;
  // 替换 onSlashTrigger 报告的“/query”。
  replaceSlashTrigger: (html: string) => boolean;
};

export type EmailEditorProps = {
  appearance?: "contained" | "seamless";
  initialHtml: string;
  mode?: EmailBodyMode;
  preservedBlocks?: EmailEditorPreservedBlock[];
  placeholder?: string;
  autofocus?: boolean;
  onStateChange?: (state: EmailEditorState) => void;
  onImageFiles?: (files: File[]) => void;
  // 在行首或空白后输入的“/”。
  onSlashTrigger?: (trigger: EmailEditorSlashTrigger | null) => void;
  // 斜杠触发器打开时输入的按键。已处理时返回 true。
  onSlashKeyDown?: (event: KeyboardEvent) => boolean;
  // 将远程图片 URL 映射为用于显示的代理 URL。没有映射的图片
  // 显示其替代文本；发送的 HTML 保留原始地址。
  resolveRemoteImages?: (
    sources: string[],
  ) => Promise<Record<string, string | null>>;
};

// Squire 在模块加载时会访问 DOM，因此必须排除在服务端渲染之外。
const SquireEmailEditor = lazy(() =>
  import("./squire/SquireEmailEditor").then((module) => ({
    default: module.SquireEmailEditor,
  })),
);

export const EmailEditor = forwardRef<EmailEditorHandle, EmailEditorProps>(
  function EmailEditor(
    {
      appearance = "contained",
      initialHtml,
      mode = "original",
      preservedBlocks = [],
      placeholder = "写一封邮件…",
      autofocus = true,
      onStateChange,
      onImageFiles,
      onSlashKeyDown,
      onSlashTrigger,
      resolveRemoteImages,
    },
    ref,
  ) {
    const [initialState] = useState(() => ({
      initialHtml,
      appearance,
      mode,
      placeholder,
      autofocus,
      preservedBlocks: preservedBlocks.map((block) => ({
        id: block.id,
        kind: block.kind,
        previewHtml: sanitizePreservedEmailHtmlForPreview(block.html),
        editableHtml:
          block.kind === "signature"
            ? (prepareEmailBodySignatureHtml(block.html) ?? undefined)
            : undefined,
      })),
    }));

    return (
      <Suspense fallback={<div className={styles.surface} aria-busy="true" />}>
        <SquireEmailEditor
          ref={ref}
          appearance={initialState.appearance}
          autofocus={initialState.autofocus}
          initialHtml={initialState.initialHtml}
          initialMode={initialState.mode}
          onImageFiles={onImageFiles}
          onSlashKeyDown={onSlashKeyDown}
          onSlashTrigger={onSlashTrigger}
          onStateChange={onStateChange}
          placeholder={initialState.placeholder}
          preservedBlocks={initialState.preservedBlocks}
          resolveRemoteImages={resolveRemoteImages}
        />
      </Suspense>
    );
  },
);
