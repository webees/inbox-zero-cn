"use client";

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
        <TabsTrigger value="cold-emails">冷邮件</TabsTrigger>
        <TabsTrigger value="rejected">标记为非冷邮件</TabsTrigger>
        <TabsTrigger value="test">测试</TabsTrigger>
        <TabsTrigger value="settings">设置</TabsTrigger>
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
          要管理冷邮件设置，请前往 AI 助手规则标签页，然后点击冷邮件规则的编辑。
        </MessageText>
        <Button asChild variant="outline">
          <Link href={prefixPath(emailAccountId, "/automation?tab=rules")}>
            前往 AI 助手规则
          </Link>
        </Button>
      </TabsContent>
    </Tabs>
  );
}
