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
  // 在光标处将纯文本另起行引用，并将光标留在引用下方的新行。
  insertQuote: (text: string) => boolean;
  insertInlineImage: (image: {
    alt: string;
    contentId: string;
    previewUrl: string;
  }) => boolean;
  removeInlineImage: (contentId: string) => boolean;
  // 将签名替换为另一个，如果没有签名则添加。空 HTML
  // 会移除签名。消息的其余部分保持原样。
  replaceSignature: (html: string) => boolean;
  // 替换 onSlashTrigger 报告的命令或查询文本。
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
  // 在行首或空白之后输入的 "/"。
  onSlashTrigger?: (trigger: EmailEditorSlashTrigger | null) => void;
  // 斜杠触发项打开时输入的按键。已处理时返回 true。
  onSlashKeyDown?: (event: KeyboardEvent) => boolean;
  // 将远程图片 URL 映射为用于显示的代理 URL。没有映射的图片
  // 显示其替代文本；发送的 HTML 保留原始地址。
  resolveRemoteImages?: (
    sources: string[],
  ) => Promise<Record<string, string | null>>;
};

// Squire 在模块加载时会操作 DOM，因此使用该组件时
// 必须避开服务端渲染
const loadSquireEmailEditor = () => import("./squire/SquireEmailEditor");

const SquireEmailEditor = lazy(() =>
  loadSquireEmailEditor().then((module) => ({
    default: module.SquireEmailEditor,
  })),
);

/** 仅在浏览器中提前获取编辑器，使其通常在打开前就已加载。 */
export function preloadEmailEditor() {
  loadSquireEmailEditor().catch(() => {
    // 渲染编辑器时会在其回退界面后重试下载。
  });
}

export const EmailEditor = forwardRef<EmailEditorHandle, EmailEditorProps>(
  function EmailEditor(
    {
      appearance = "contained",
      initialHtml,
      mode = "original",
      preservedBlocks = [],
      placeholder = "撰写邮件…",
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
