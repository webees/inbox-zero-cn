import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AddAccount } from "@/app/(app)/accounts/AddAccount";
import { MutedText } from "@/components/Typography";
import { auth } from "@/utils/auth";
import { BRAND_NAME, getBrandTitle } from "@/utils/branding";
import { getConnectMailboxNextPath } from "@/utils/connect-mailbox";
import prisma from "@/utils/prisma";

export const metadata: Metadata = {
  title: getBrandTitle("连接邮箱"),
  description: `连接 Google 或 Microsoft 邮箱以继续使用 ${BRAND_NAME}。`,
  alternates: { canonical: "/connect-mailbox" },
};

export default async function ConnectMailboxPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) redirect("/login");

  const nextPath = getConnectMailboxNextPath(searchParams?.next);
  const emailAccount = await prisma.emailAccount.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (emailAccount) redirect(nextPath);

  return (
    <div className="flex min-h-screen flex-col justify-center text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4">
        <div className="text-center">
          <h1 className="font-title text-2xl text-foreground">连接你的邮箱</h1>
          <p className="mt-4 text-muted-foreground">
            连接 Gmail 或 Outlook 以开始使用 {BRAND_NAME}。
          </p>
        </div>

        <AddAccount helperText="你之后可以在账号页面添加更多邮箱。" />

        <MutedText className="text-center">
          此处使用 Google 和 Microsoft 仅用于连接你的收件箱数据。
        </MutedText>
      </div>
    </div>
  );
}
