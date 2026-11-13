"use client";

import { Trans } from "@lingui/react/macro";
import { ColdEmailList } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailList";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ColdEmailRejected } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailRejected";
import { ColdEmailTest } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailTest";
import { Button } from "@/components/ui/button";
import { prefixPath } from "@/utils/path";
import { useAccount } from "@/providers/EmailAccountProvider";
import Link from "next/link";
import { MessageText } from "@/components/Typography";

export function ColdEmailContent({ searchParam }: { searchParam?: string }) {
  const { emailAccountId } = useAccount();

  return (
    <Tabs defaultValue="cold-emails" searchParam={searchParam}>
      <TabsList>
        <TabsTrigger value="cold-emails">
          <Trans>冷邮件</Trans>
        </TabsTrigger>
        <TabsTrigger value="rejected">
          <Trans>已标记为非冷邮件</Trans>
        </TabsTrigger>
        <TabsTrigger value="test">
          <Trans>测试</Trans>
        </TabsTrigger>
        <TabsTrigger value="settings">
          <Trans>设置</Trans>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="test" className="mb-10">
        <ColdEmailTest />
      </TabsContent>

      <TabsContent value="cold-emails" className="mb-10">
        <Card>
          <ColdEmailList />
        </Card>
      </TabsContent>
      <TabsContent value="rejected" className="mb-10">
        <Card>
          <ColdEmailRejected />
        </Card>
      </TabsContent>

      <TabsContent value="settings" className="mb-10">
        <MessageText className="my-4">
          <Trans>
            要管理冷邮件设置，请前往“助手规则”标签页，然后点击“冷邮件”规则上的“编辑”。
          </Trans>
        </MessageText>
        <Button asChild variant="outline">
          <Link href={prefixPath(emailAccountId, "/automation?tab=rules")}>
            <Trans>前往助手规则</Trans>
          </Link>
        </Button>
      </TabsContent>
    </Tabs>
  );
}
