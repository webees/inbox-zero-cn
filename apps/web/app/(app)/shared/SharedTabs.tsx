"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { usePathname } from "next/navigation";
import { TabSelect } from "@/components/TabSelect";
import { PageHeading, PageSubHeading } from "@/components/Typography";

export function SharedTabs() {
  const { t } = useLingui();
  const pathname = usePathname();

  return (
    <div>
      <div className="mb-4">
        <PageHeading>
          <Trans>讨论</Trans>
        </PageHeading>
        <PageSubHeading className="mt-1">
          <Trans>队友与你分享、供你在私密评论中讨论的邮件会话。</Trans>
        </PageSubHeading>
      </div>
      <div className="border-b border-neutral-200">
        <TabSelect
          options={[
            { id: "conversations", label: t`会话`, href: "/shared" },
            { id: "activity", label: t`动态`, href: "/shared/activity" },
          ]}
          selected={
            pathname.endsWith("/activity") ? "activity" : "conversations"
          }
        />
      </div>
    </div>
  );
}

export function NoOrganization() {
  return (
    <p className="text-muted-foreground text-sm">
      <Trans>
        此账号不属于任何组织。请切换到已加入组织的账号，以查看队友与你分享的会话。
      </Trans>
    </p>
  );
}
