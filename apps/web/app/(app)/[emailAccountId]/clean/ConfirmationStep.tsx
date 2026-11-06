"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { MutedText, TypographyH3 } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/Badge";
import { cleanInboxAction } from "@/utils/actions/clean";
import { toastError } from "@/components/Toast";
import { CleanAction } from "@/generated/prisma/enums";
import { PREVIEW_RUN_COUNT } from "@/app/(app)/[emailAccountId]/clean/consts";
import { HistoryIcon, SettingsIcon } from "lucide-react";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";

export function ConfirmationStep({
  showFooter,
  action,
  timeRange,
  instructions,
  skips,
  reuseSettings,
}: {
  showFooter: boolean;
  action: CleanAction;
  timeRange: number;
  instructions?: string;
  skips: {
    reply: boolean;
    starred: boolean;
    calendar: boolean;
    receipt: boolean;
    attachment: boolean;
  };
  reuseSettings: boolean;
}) {
  const router = useRouter();
  const { emailAccountId } = useAccount();

  const handleStartCleaning = async () => {
    const result = await cleanInboxAction(emailAccountId, {
      daysOld: timeRange ?? 7,
      instructions: instructions || "",
      action: action || CleanAction.ARCHIVE,
      maxEmails: PREVIEW_RUN_COUNT,
      skips,
    });

    if (result?.serverError) {
      toastError({ description: result.serverError });
      return;
    }

    router.push(
      prefixPath(
        emailAccountId,
        `/clean/run?jobId=${result?.data?.jobId}&isPreviewBatch=true`,
      ),
    );
  };

  return (
    <div className="text-center">
      <Image
        src="/images/illustrations/business-success-chart.svg"
        alt="清理"
        width={200}
        height={200}
        className="mx-auto dark:brightness-90 dark:invert"
        unoptimized
      />

      <TypographyH3 className="mt-2">准备好清理你的收件箱了吗</TypographyH3>

      <ul className="mx-auto mt-4 max-w-prose list-disc space-y-2 pl-4 text-left">
        <li>我们会在首次清理中处理 {PREVIEW_RUN_COUNT} 封邮件。</li>
        <li>如果你对结果满意，我们会继续处理你收件箱中剩余的邮件。</li>
        {/* 待办：我们应只统计正在处理的邮件 */}
        {/* <li>
          处理 {unhandledCount} 封邮件的完整过程大约需要
          {estimatedTime}
        </li> */}
        <li>
          {action === CleanAction.ARCHIVE ? (
            <>
              已归档的邮件会在 Gmail 中打上 <Badge color="green">已归档</Badge>
              标签。
            </>
          ) : (
            <>
              标记为已读的邮件会在 Gmail 中打上{" "}
              <Badge color="green">已读</Badge>标签。
            </>
          )}
        </li>
        <li>不会删除任何邮件——所有内容都可以在搜索中找到。</li>
        {reuseSettings && (
          <li>
            我们会沿用你上次清理收件箱时的设置。你可以{" "}
            <Link
              className="font-semibold hover:underline"
              href={prefixPath(emailAccountId, "/clean/onboarding")}
            >
              在这里
            </Link>
            调整。
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Button size="lg" onClick={handleStartCleaning}>
          开始清理
        </Button>
      </div>

      {showFooter && (
        <MutedText className="mt-6 flex items-center justify-center space-x-6">
          <FooterLink
            icon={HistoryIcon}
            text="历史记录"
            href={prefixPath(emailAccountId, "/clean/history")}
          />
          <FooterLink
            icon={SettingsIcon}
            text="编辑设置"
            href={prefixPath(emailAccountId, "/clean/onboarding")}
          />
        </MutedText>
      )}
    </div>
  );
}

const FooterLink = ({
  icon: Icon,
  text,
  href,
}: {
  icon: React.ElementType;
  text: string;
  href: string;
}) => (
  <Link
    href={href}
    className="flex items-center transition-colors hover:text-primary"
  >
    <Icon className="mr-1 h-4 w-4" />
    <span>{text}</span>
  </Link>
);
