"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
        alt={t`清理`}
        width={200}
        height={200}
        className="mx-auto dark:brightness-90 dark:invert"
        unoptimized
      />

      <TypographyH3 className="mt-2">
        <Trans>准备好清理你的收件箱了吗</Trans>
      </TypographyH3>

      <ul className="mx-auto mt-4 max-w-prose list-disc space-y-2 pl-4 text-left">
        <li>
          <Plural
            value={PREVIEW_RUN_COUNT}
            one="我们将在首次清理中处理 # 封邮件。"
            other="我们将在首次清理中处理 # 封邮件。"
          />
        </li>
        <li>
          <Trans>如果你对结果满意，我们将继续处理收件箱中剩余的邮件。</Trans>
        </li>
        {/* TODO: we should count only emails we're processing */}
        {/* <li>
          The full process to handle {unhandledCount} emails will take
          approximately {estimatedTime}
        </li> */}
        <li>
          {action === CleanAction.ARCHIVE ? (
            <Trans>
              已归档的邮件将在 Gmail 中被标记为{" "}
              <Badge color="green">{ARCHIVED_LABEL}</Badge>。
            </Trans>
          ) : (
            <Trans>
              标记为已读的邮件将在 Gmail 中被标记为{" "}
              <Badge color="green">{READ_LABEL}</Badge>。
            </Trans>
          )}
        </li>
        <li>
          <Trans>不会删除任何邮件 - 所有邮件都可以在搜索中找到。</Trans>
        </li>
        {reuseSettings && (
          <li>
            <Trans>
              我们将使用你上次清理收件箱时的设置。你可以
              <Link
                className="font-semibold hover:underline"
                href={prefixPath(emailAccountId, "/clean/onboarding")}
              >
                在此
              </Link>
              调整。
            </Trans>
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Button size="lg" onClick={handleStartCleaning}>
          <Trans>开始清理</Trans>
        </Button>
      </div>

      {showFooter && (
        <MutedText className="mt-6 flex items-center justify-center space-x-6">
          <FooterLink
            icon={HistoryIcon}
            text={t`History`}
            href={prefixPath(emailAccountId, "/clean/history")}
          />
          <FooterLink
            icon={SettingsIcon}
            text={t`Edit settings`}
            href={prefixPath(emailAccountId, "/clean/onboarding")}
          />
        </MutedText>
      )}
    </div>
  );
}

// Real Gmail label names, so not translated
const ARCHIVED_LABEL = "Archived";
const READ_LABEL = "Read";

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
