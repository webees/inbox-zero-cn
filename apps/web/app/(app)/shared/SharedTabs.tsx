"use client";

import { usePathname } from "next/navigation";
import { TabSelect } from "@/components/TabSelect";
import { PageHeading, PageSubHeading } from "@/components/Typography";

export function SharedTabs() {
  const pathname = usePathname();

  return (
    <div>
      <div className="mb-4">
        <PageHeading>讨论</PageHeading>
        <PageSubHeading className="mt-1">
          团队成员与你分享、用于私密评论讨论的邮件会话。
        </PageSubHeading>
      </div>
      <div className="border-b border-neutral-200">
        <TabSelect
          options={[
            { id: "conversations", label: "会话", href: "/shared" },
            { id: "activity", label: "活动", href: "/shared/activity" },
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
      此账号不属于任何组织。请切换到已加入组织的账号，以查看团队成员与你分享的会话。
    </p>
  );
}
