"use client";

import { SettingsContent } from "@/app/(app)/settings/SettingsContent";
import { PageHeader } from "@/components/PageHeader";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";

export default function SettingsPage() {
  const { isSettingsOpen } = useSettingsDialog();

  return (
    <div className="content-container pb-12">
      <div className="mx-auto max-w-5xl space-y-10 pt-4">
        <PageHeader title="设置" />
        {/* 弹窗渲染相同的内容，因此只挂载其中一个。 */}
        {!isSettingsOpen && <SettingsContent />}
      </div>
    </div>
  );
}
