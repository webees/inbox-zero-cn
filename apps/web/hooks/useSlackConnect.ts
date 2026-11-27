"use client";

import { useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { fetchWithAccount } from "@/utils/fetch";
import { captureException, getActionErrorMessage } from "@/utils/error";
import { toastError, toastSuccess, toastInfo } from "@/components/Toast";
import { linkSlackWorkspaceAction } from "@/utils/actions/messaging-channels";
import type { GetSlackAuthUrlResponse } from "@/app/api/slack/auth-url/route";

export function useSlackConnect({
  emailAccountId,
  onConnected,
}: {
  emailAccountId: string;
  onConnected?: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);

  const { executeAsync: linkSlack } = useAction(
    linkSlackWorkspaceAction.bind(null, emailAccountId),
  );

  const connect = async () => {
    if (connecting || connectingRef.current) return;

    connectingRef.current = true;
    setConnecting(true);
    try {
      const res = await fetchWithAccount({
        url: "/api/slack/auth-url",
        emailAccountId,
      });
      if (!res.ok) throw new Error("获取 Slack 授权 URL 失败");
      const data: GetSlackAuthUrlResponse = await res.json();

      if (data.existingWorkspace) {
        const result = await linkSlack({
          teamId: data.existingWorkspace.teamId,
        });

        if (!result?.serverError && !result?.validationErrors) {
          toastSuccess({ description: "已连接 Slack" });
          onConnected?.();
          return;
        }

        const linkError = getActionErrorMessage(
          {
            serverError: result?.serverError,
            validationErrors: result?.validationErrors,
          },
          "关联 Slack 工作区失败",
        );

        if (linkError.includes("Could not find your Slack account")) {
          toastInfo({
            title: "在 Slack 中找不到你的邮箱",
            description: "正在跳转到 Slack 授权…",
          });
        } else {
          toastInfo({
            title: "在 Slack 中继续",
            description: "正在跳转到 Slack 授权…",
          });
        }
        // Always fall through to OAuth so the user isn't stuck.
      }

      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("未返回授权 URL");
      }
    } catch (error) {
      captureException(error, { extra: { context: "Slack connect" } });
      toastError({ description: "连接 Slack 失败" });
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  };

  return { connect, connecting };
}
