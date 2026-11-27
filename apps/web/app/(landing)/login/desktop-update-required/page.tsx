import type { Metadata } from "next";
import Link from "next/link";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { ErrorPage } from "@/components/ErrorPage";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "更新 Inbox Zero Desktop",
};

export default function DesktopUpdateRequiredPage() {
  return (
    <BasicLayout>
      <ErrorPage
        title="更新桌面应用以登录"
        description="此版本的 Inbox Zero Desktop 已无法完成登录。请下载最新版本，重新打开应用，然后再次尝试登录。"
        button={
          <Button asChild>
            <Link href="/download">下载最新版桌面应用</Link>
          </Button>
        }
      />
    </BasicLayout>
  );
}
