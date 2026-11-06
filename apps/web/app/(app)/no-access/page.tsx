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

export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            无权访问
          </CardTitle>
          <CardDescription>未找到邮箱账号，或者你无权访问它</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/accounts">查看账号</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
