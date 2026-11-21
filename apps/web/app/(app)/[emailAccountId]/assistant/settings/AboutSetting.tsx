"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingCard } from "@/components/SettingCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AboutSection } from "@/app/(app)/[emailAccountId]/settings/AboutSectionForm";

export function AboutSetting() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  return (
    <SettingCard
      title={t`个人说明`}
      description={t`向 AI 介绍你自己，以及你希望它如何处理你的邮件。`}
      right={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trans>编辑</Trans>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                <Trans>个人说明</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>向 AI 介绍你自己，以及你希望它如何处理你的邮件。</Trans>
              </DialogDescription>
            </DialogHeader>

            <AboutSection onSuccess={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      }
    />
  );
}
