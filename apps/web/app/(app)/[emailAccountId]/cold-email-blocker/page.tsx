import { Suspense } from "react";
import { PermissionsCheck } from "@/app/(app)/[emailAccountId]/PermissionsCheck";
import { EmailLabelsProvider } from "@/providers/EmailLabelsProvider";
import { ColdEmailContent } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailContent";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";

export default function ColdEmailBlockerPage() {
  return (
    <PageWrapper>
      <PageHeader
        title="冷邮件拦截器"
        video={{
          title: "冷邮件拦截器入门",
          description:
            "了解如何查看被拦截的冷邮件、拯救发件人，以及设置冷邮件的处理方式。",
          muxPlaybackId: "E29tx0001FmSQqASvIM7r87P9Pro3cq0202AiZ8rOKzsyJM",
        }}
      />
      <EmailLabelsProvider>
        <Suspense>
          <PermissionsCheck />
          <div className="mt-4">
            <ColdEmailContent />
          </div>
        </Suspense>
      </EmailLabelsProvider>
    </PageWrapper>
  );
}
