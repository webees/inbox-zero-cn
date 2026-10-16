"use client";

import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { ThreadReaderProps } from "@/app/(app)/[emailAccountId]/mail/ThreadReader";

export function BufferedThreadReader({
  children,
  threadKey,
  dataReady,
  onReady,
}: {
  children: ReactElement<ThreadReaderProps>;
  threadKey: string;
  dataReady: boolean;
  onReady: (threadKey: string) => void;
}) {
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  // 保存在 state 之外，这样同一会话的父级重新渲染不会
  // 让阅读器渲染两次。
  const visibleContent = useRef<ReactElement<ThreadReaderProps> | null>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const readinessDeadline = useRef<{ key: string; expiresAt: number } | null>(
    null,
  );
  const previous =
    visibleKey !== null && visibleContent.current
      ? { key: visibleKey, content: visibleContent.current }
      : null;
  const replacing =
    previous !== null &&
    previous.key !== threadKey &&
    previous.content.props.threadId !== null;
  useLayoutEffect(() => {
    if (!replacing) onReady(threadKey);
    if (readinessDeadline.current?.key !== threadKey) {
      readinessDeadline.current = {
        key: threadKey,
        expiresAt: performance.now() + 2000,
      };
    }
    const { expiresAt } = readinessDeadline.current;
    const remaining = expiresAt - performance.now();
    let frame: number;
    const commit = () => {
      visibleContent.current = children;
      setVisibleKey(threadKey);
      onReady(threadKey);
    };
    // 加载缓慢或邮件格式错误时，不能让上一个会话无限期地留在
    // 屏幕上；超过期限后阅读器会改为显示自己的加载
    // 或错误状态。
    const timeout = setTimeout(commit, Math.max(0, remaining));
    if (!dataReady) return () => clearTimeout(timeout);
    const reveal = () => {
      const iframes = pendingRef.current?.querySelectorAll("iframe");
      // React 提交该消息并不意味着它的 srcDoc 已被解析
      // 和测量。在两者都就绪之前，保留完整的上一个阅读器。
      if (
        performance.now() < expiresAt &&
        iframes &&
        Array.from(iframes).some(
          (iframe) => iframe.dataset.emailReady !== "true",
        )
      ) {
        frame = requestAnimationFrame(reveal);
        return;
      }
      clearTimeout(timeout);
      commit();
    };
    reveal();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [children, onReady, dataReady, threadKey, replacing]);

  const current = {
    key: threadKey,
    content:
      !dataReady && previous?.key === threadKey ? previous.content : children,
  };
  const readers = replacing ? [previous, current] : [current];

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1" aria-busy={replacing}>
      {readers.map((reader) => {
        const pending = replacing && reader.key === threadKey;
        return (
          <div
            key={reader.key}
            ref={reader.key === threadKey ? pendingRef : undefined}
            className="flex min-h-0 min-w-0 flex-1"
            style={
              pending
                ? { position: "absolute", inset: 0, visibility: "hidden" }
                : undefined
            }
            inert={replacing}
            aria-hidden={pending || undefined}
          >
            {cloneElement(reader.content, {
              menu: replacing ? undefined : reader.content.props.menu,
              enableMessageNavigation:
                !replacing && reader.content.props.enableMessageNavigation,
              detailSelectionSettled:
                !replacing && reader.content.props.detailSelectionSettled,
            })}
          </div>
        );
      })}
    </div>
  );
}
