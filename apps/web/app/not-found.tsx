"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErrorPage } from "@/components/ErrorPage";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { Button } from "@/components/ui/button";
import { createClientLogger } from "@/utils/logger-client";

const logger = createClientLogger("not-found");

export default function NotFound() {
  const pathname = usePathname();

  useEffect(() => {
    logger.warn("页面未找到", { pathname });
  }, [pathname]);

  return (
    <BasicLayout>
      <ErrorPage
        title="页面未找到"
        description="请求的页面不存在。请返回首页、阅读 Agent 指南，或搜索文档。"
        button={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/">返回首页</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/llms.txt">Agent 指南</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="https://docs.getinboxzero.com">文档</Link>
            </Button>
          </div>
        }
      />
    </BasicLayout>
  );
}
