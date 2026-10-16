import { NEXT_ACTION_NOT_FOUND_HEADER } from "next/dist/client/components/app-router-headers";
import { toast } from "sonner";

const RELOADED_AT_KEY = "stale-deployment-reloaded-at";
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const TOAST_ID = "stale-deployment";

// 部署期间一直打开的窗口仍会调用上一个构建的 server action id，
// Next.js 会以 UnrecognizedActionError 拒绝。各调用点捕获该错误的
// 方式多种多样，因此这里监视每个 action 调用都会经过的唯一位置：
// Next.js 标记为 "action not found" 的响应。
export function installStaleDeploymentReload() {
  const fetchBeforeInstall = window.fetch;
  window.fetch = async (...args) => {
    const response = await fetchBeforeInstall(...args);
    if (response.headers.get(NEXT_ACTION_NOT_FOUND_HEADER) === "1") {
      handleStaleDeployment();
    }
    return response;
  };
}

export function claimStaleDeploymentReload(
  storage: Pick<Storage, "getItem" | "setItem">,
  nowMs: number,
) {
  const reloadedAt = Number(storage.getItem(RELOADED_AT_KEY));
  // 重新加载后仍落到旧构建（例如页面的离线副本）时，
  // 绝不能变成重新加载循环。
  if (reloadedAt && nowMs - reloadedAt < RELOAD_COOLDOWN_MS) return false;
  storage.setItem(RELOADED_AT_KEY, String(nowMs));
  return true;
}

function handleStaleDeployment() {
  // 草稿通过短防抖保存，因此在输入过程中重新加载可能会丢失
  // 最后几个字符。当用户正在输入，或循环保护或存储规则
  // 排除自动重新加载时，让用户自行选择时机。
  if (!isEditingText() && claimAutomaticReload()) {
    window.location.reload();
    return;
  }
  toast.info("Inbox Zero 已更新", {
    id: TOAST_ID,
    description: "重新加载以继续使用最新版本。",
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "重新加载",
      onClick: () => window.location.reload(),
    },
  });
}

function claimAutomaticReload() {
  try {
    return claimStaleDeploymentReload(window.sessionStorage, Date.now());
  } catch {
    return false;
  }
}

function isEditingText() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "submit", "reset"].includes(
        element.type,
      ))
  );
}
