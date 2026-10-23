import type { Metadata } from "next";
import Link from "next/link";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { ErrorPage } from "@/components/ErrorPage";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "应用登录未完成",
};

export default function AppSignInErrorPage() {
  return (
    <BasicLayout>
      <ErrorPage
        title="应用登录未完成"
        description="返回应用并重新开始登录。如果你使用的是 Inbox Zero Desktop 且此问题反复出现，请安装最新版本。"
        button={
          <Button asChild>
            <Link href="/download">获取最新桌面应用</Link>
          </Button>
        }
      />
    </BasicLayout>
  );
}
