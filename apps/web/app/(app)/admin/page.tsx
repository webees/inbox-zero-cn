import { env } from "@/env";
import { AdminScimCredentials } from "@/app/(app)/admin/AdminScimCredentials";
import { AdminUpgradeUserForm } from "@/app/(app)/admin/AdminUpgradeUserForm";
import { AdminUserControls } from "@/app/(app)/admin/AdminUserControls";
import { auth } from "@/utils/auth";
import { ErrorPage } from "@/components/ErrorPage";
import { isAdmin } from "@/utils/admin";
import {
  AdminBackfillPremiumAdmins,
  AdminSyncStripe,
  AdminSyncStripeCustomers,
} from "@/app/(app)/admin/AdminSyncStripe";
import { RegisterSSOModal } from "@/app/(app)/admin/RegisterSSOModal";
import { AdminUserInfo } from "@/app/(app)/admin/AdminUserInfo";
import { AdminHashEmail } from "@/app/(app)/admin/AdminHashEmail";
import { GmailUrlConverter } from "@/app/(app)/admin/GmailUrlConverter";
import { DebugLabels } from "@/app/(app)/admin/DebugLabels";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { AdminTopSpenders } from "@/app/(app)/admin/AdminTopSpenders";

// 注意：在 Vercel 上开启 Fluid Compute，以允许最长 800 秒的执行时长
export const maxDuration = 800;

export default async function AdminPage() {
  const session = await auth();

  if (!isAdmin({ email: session?.user.email })) {
    return (
      <ErrorPage title="无权访问" description="你没有访问此页面的权限。" />
    );
  }

  return (
    <PageWrapper>
      <PageHeader title="管理后台" />

      <div className="space-y-8 mt-4 mb-20">
        <AdminUpgradeUserForm />
        <AdminUserControls />
        <AdminUserInfo />
        <AdminHashEmail />
        <GmailUrlConverter />
        <DebugLabels />
        <RegisterSSOModal />
        {env.SCIM_CREDENTIAL_HASH_SECRET && <AdminScimCredentials />}

        <div className="flex gap-2">
          <AdminSyncStripe />
          <AdminSyncStripeCustomers />
          <AdminBackfillPremiumAdmins />
        </div>

        <AdminTopSpenders />
      </div>
    </PageWrapper>
  );
}
