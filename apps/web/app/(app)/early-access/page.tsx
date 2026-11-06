"use client";

import Link from "next/link";
import { EarlyAccessFeatures } from "@/app/(app)/early-access/EarlyAccessFeatures";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { prefixPath } from "@/utils/path";
import { useAccount } from "@/providers/EmailAccountProvider";

export default function RequestAccessPage() {
  const { emailAccountId, provider } = useAccount();

  return (
    <div className="container px-2 pt-2 sm:px-4 sm:pt-8">
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-8">
        <EarlyAccessFeatures />
        <Card>
          <CardHeader>
            <CardTitle>邮件</CardTitle>
            <CardDescription>
              在 Inbox Zero 邮件客户端中打开你的收件箱。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emailAccountId ? (
              <Button asChild>
                <Link href={prefixPath(emailAccountId, "/mail")}>打开邮件</Link>
              </Button>
            ) : (
              <Button disabled>打开邮件</Button>
            )}
          </CardContent>
        </Card>
        {isGoogleProvider(provider) && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>发件人分类</CardTitle>
                <CardDescription>
                  发件人分类功能允许你按发件人对邮件进行分类，并对它们执行批量操作或应用规则。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/smart-categories">发件人分类</Link>
                </Button>
              </CardContent>
            </Card>
            {/* <Card>
              <CardHeader>
                <CardTitle>批量归档</CardTitle>
                <CardDescription>
                  一次归档来自多个发件人的邮件，并按分类整理。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/bulk-archive">批量归档</Link>
                </Button>
              </CardContent>
            </Card> */}
            {/* <Card>
              <CardHeader>
                <CardTitle>快速批量归档</CardTitle>
                <CardDescription>
                  快速一次归档来自多个发件人的邮件，并按 AI 置信度分组。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/quick-bulk-archive">快速批量归档</Link>
                </Button>
              </CardContent>
            </Card> */}
          </>
        )}
        <Card>
          <CardHeader>
            <CardTitle>抢先体验</CardTitle>
            <CardDescription>告诉我们你希望看到哪些功能。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/waitlist" target="_blank">
                反馈表单
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
