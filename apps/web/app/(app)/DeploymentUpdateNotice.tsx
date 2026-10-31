"use client";

import { useEffect } from "react";
import { toastInfo } from "@/components/Toast";
import type { DeploymentResponse } from "@/app/api/deployment/route";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;

// 邮件标签页会持续打开数天，超过主机的时钟偏差保护窗口。一旦某个标签页
// 对应的部署已不存在，它的 server action 和懒加载代码块可能会以用户无法
// 理解的方式失败，因此改为提示用户重新加载。
export function DeploymentUpdateNotice() {
  useEffect(() => {
    const tabDeploymentId = process.env.NEXT_DEPLOYMENT_ID;
    if (!tabDeploymentId) return;

    let lastCheckAt = 0;
    let notified = false;
    const check = async () => {
      if (notified || Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
      lastCheckAt = Date.now();
      try {
        const response = await fetch("/api/deployment", { cache: "no-store" });
        if (!response.ok) return;
        const { deploymentId }: DeploymentResponse = await response.json();
        if (!deploymentId || deploymentId === tabDeploymentId || notified)
          return;
        notified = true;
        toastInfo({
          id: "deployment-update",
          title: "Inbox Zero 已更新",
          description: "重新加载以获取最新版本。",
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "重新加载",
            onClick: () => window.location.reload(),
          },
        });
      } catch {
        // 离线或正在部署中；下次检查会重试。
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") check();
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
