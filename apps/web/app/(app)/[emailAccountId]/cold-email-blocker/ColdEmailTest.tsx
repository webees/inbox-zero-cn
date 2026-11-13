import { Trans } from "@lingui/react/macro";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TestRulesContent } from "@/app/(app)/[emailAccountId]/cold-email-blocker/TestRules";

export function ColdEmailTest() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>测试冷邮件拦截器</Trans>
        </CardTitle>

        <CardDescription>
          <Trans>检查你的冷邮件拦截器对以往邮件的表现。</Trans>
        </CardDescription>
      </CardHeader>
      <TestRulesContent />
    </Card>
  );
}
