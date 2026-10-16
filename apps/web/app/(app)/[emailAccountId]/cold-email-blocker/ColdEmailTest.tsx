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
        <CardTitle>测试冷邮件拦截器</CardTitle>

        <CardDescription>
          检查冷邮件拦截器在历史邮件中的判定效果。
        </CardDescription>
      </CardHeader>
      <TestRulesContent />
    </Card>
  );
}
