"use client";

import { Trans } from "@lingui/react/macro";
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
            <CardTitle>
              <Trans>邮件</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>在 Inbox Zero 邮件客户端中打开你的收件箱。</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emailAccountId ? (
              <Button asChild>
                <Link href={prefixPath(emailAccountId, "/mail")}>
                  <Trans>打开邮件</Trans>
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Trans>打开邮件</Trans>
              </Button>
            )}
          </CardContent>
        </Card>
        {isGoogleProvider(provider) && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans>发件人分类</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    发件人分类功能可让你按发件人对邮件分类，并批量操作或对其应用规则。
                  </Trans>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/smart-categories">
                    <Trans>发件人分类</Trans>
                  </Link>
                </Button>
              </CardContent>
            </Card>
            {/* <Card>
              <CardHeader>
                <CardTitle>批量归档</CardTitle>
                <CardDescription>
                  按分类整理并一次性归档来自多个发件人的邮件。
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
                  按 AI 置信度分组，快速一次性归档来自多个发件人的邮件。
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
            <CardTitle>
              <Trans>抢先体验</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>告诉我们你希望看到哪些功能。</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/waitlist" target="_blank">
                <Trans>反馈表单</Trans>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
