"use client";

import Image from "next/image";
import { AlertCircle, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useIsOnline } from "@/hooks/useIsOnline";
import { logOut } from "@/utils/user";
import { env } from "@/env";

// TODO would be better to have a consistent definition here. didn't want to break things.
export function ErrorDisplay(props: {
  error: { info?: { error?: string | object }; error?: string | object };
}) {
  const online = useIsOnline();
  const errorMessage =
    safeErrorToString(props.error?.info?.error) ||
    safeErrorToString(props.error?.error);

  if (props.error && !online) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WifiOffIcon />
          </EmptyMedia>
          <EmptyTitle>你已离线</EmptyTitle>
          <EmptyDescription>请检查你的网络连接后重试。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (errorMessage) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10">
            <AlertCircle className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>出错了</EmptyTitle>
          <EmptyDescription>{errorMessage}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (props.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10">
            <AlertCircle className="text-destructive" />
          </EmptyMedia>
          <EmptyTitle>出错了</EmptyTitle>
          <EmptyDescription>
            请刷新页面；如果错误仍然存在，请联系支持团队{" "}
            <a href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>
              {env.NEXT_PUBLIC_SUPPORT_EMAIL}
            </a>
            。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return null;
}

export const NotLoggedIn = () => (
  <div className="flex flex-col items-center justify-center sm:p-20 md:p-32">
    <div className="text-lg text-gray-700">你尚未登录 😞</div>
    <Button variant="outline" className="mt-2" onClick={() => logOut("/login")}>
      登录
    </Button>
    <div className="mt-8">
      <Image
        src="/images/illustrations/falling.svg"
        alt=""
        width={400}
        height={400}
        unoptimized
        className="dark:brightness-90 dark:invert"
      />
    </div>
  </div>
);

const safeErrorToString = (
  error: string | object | undefined,
): string | null => {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    // 处理带 issues 数组的 Zod 校验错误
    if ("issues" in error && Array.isArray(error.issues)) {
      return error.issues
        .map((issue) => issue.message || "校验错误")
        .join(", ");
    }
    // 对于其他对象，尝试安全地字符串化
    try {
      return JSON.stringify(error);
    } catch {
      return "数据格式无效";
    }
  }
  return String(error);
};
