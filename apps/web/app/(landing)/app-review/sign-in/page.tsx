import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReviewSignInForm } from "@/app/(landing)/app-review/sign-in/ReviewSignInForm";
import { auth } from "@/utils/auth";
import { BRAND_NAME, getBrandTitle } from "@/utils/branding";
import { WELCOME_PATH } from "@/utils/config";
import { normalizeInternalPath } from "@/utils/path";

export const metadata: Metadata = {
  title: getBrandTitle("审核登录"),
  description: `供 ${BRAND_NAME} 审核人员登录。`,
  robots: { index: false, follow: false },
};

export default async function ReviewSignInPage(props: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const [searchParams, session] = await Promise.all([
    props.searchParams,
    auth(),
  ]);
  const nextPath = normalizeInternalPath(searchParams?.next);

  if (session?.user) {
    redirect(nextPath ?? WELCOME_PATH);
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-12">
        <div className="flex flex-col text-center">
          <h1 className="font-title text-2xl text-foreground">审核登录</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            输入 {BRAND_NAME} 提供的审核凭据。
          </p>
        </div>

        <Suspense>
          <ReviewSignInForm />
        </Suspense>
      </main>
    </div>
  );
}
