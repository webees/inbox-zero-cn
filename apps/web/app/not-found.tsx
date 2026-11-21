"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErrorPage } from "@/components/ErrorPage";
import { ClientBasicLayout } from "@/components/layouts/ClientBasicLayout";
import { Button } from "@/components/ui/button";
import { createClientLogger } from "@/utils/logger-client";

const logger = createClientLogger("not-found");

export default function NotFound() {
  const pathname = usePathname();

  useEffect(() => {
    logger.warn("页面未找到", { pathname });
  }, [pathname]);

  return (
    <ClientBasicLayout>
      <ErrorPage
        title="页面未找到"
        description="未找到你要查找的页面"
        button={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/">返回首页</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="https://docs.getinboxzero.com">文档</Link>
            </Button>
          </div>
        }
      />
    </ClientBasicLayout>
  );
}
