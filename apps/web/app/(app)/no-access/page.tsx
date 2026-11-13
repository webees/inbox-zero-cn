import { Trans } from "@lingui/react/macro";
import { initLingui } from "@/utils/i18n/server";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function NoAccessPage() {
  await initLingui();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <Trans>无访问权限</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>未找到邮箱账号，或你没有访问权限</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/accounts">
              <Trans>查看账号</Trans>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
