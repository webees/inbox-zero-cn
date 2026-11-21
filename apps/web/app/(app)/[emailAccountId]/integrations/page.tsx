"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import Link from "next/link";
import { ListChecksIcon, PenLineIcon, ZapIcon } from "lucide-react";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { Integrations } from "@/app/(app)/[emailAccountId]/integrations/Integrations";
import { FeatureIcon } from "@/components/FeatureIcon";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/ui/card";
import {
  Item,
  ItemCard,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/utils";
import { RequestAccessDialog } from "./RequestAccessDialog";
import { AddCustomMcpServerDialog } from "./AddCustomMcpServerDialog";
import { usePremium } from "@/hooks/usePremium";
import { hasTierAccess } from "@/utils/premium";
import { IntegrationsPremiumAlert } from "./IntegrationsPremiumAlert";
import {
  useIntegrationActionsEnabled,
  useIntegrationsEnabled,
} from "@/hooks/useFeatureFlags";

export default function IntegrationsPage() {
  const { t } = useLingui();
  const integrationsEnabled = useIntegrationsEnabled();
  const { tier, isLoading: isPremiumLoading } = usePremium();

  const hasAccess = hasTierAccess({
    tier: tier || null,
    minimumTier: "PLUS_MONTHLY",
  });

  // The feature flag is undefined while PostHog bootstraps
  if (integrationsEnabled === undefined) return null;

  if (!integrationsEnabled) {
    return (
      <PageWrapper>
        <div className="flex items-center justify-between gap-2">
          <PageHeader
            title={t`Integrations`}
            description={t`Connect the tools you already use.`}
          />
        </div>

        <div className="mt-8">
          <ActionCard
            variant="blue"
            icon={<ZapIcon className="h-5 w-5" />}
            title={t`集成功能尚未启用`}
            description={t`此功能正在小范围推送。加入抢先体验即可为你的账号启用集成。`}
            action={
              <Button asChild variant="outline">
                <Link href="/early-access">
                  <Trans>加入抢先体验</Trans>
                </Link>
              </Button>
            }
          />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader title={t`集成`} description={t`连接你已经在使用的工具。`} />
        {hasAccess && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
            <AddCustomMcpServerDialog />
            <RequestAccessDialog
              trigger={
                <Button variant="outline">
                  <Trans>申请集成</Trans>
                </Button>
              }
            />
          </div>
        )}
      </div>

      <div className="mt-8 space-y-4">
        {!isPremiumLoading && !hasAccess && <IntegrationsPremiumAlert />}
        <Capabilities />
        <Integrations />
      </div>
    </PageWrapper>
  );
}

function Capabilities() {
  const actionsEnabled = useIntegrationActionsEnabled();

  return (
    <ItemCard className={cn(actionsEnabled && "sm:grid sm:grid-cols-2")}>
      <Item>
        <ItemMedia>
          <FeatureIcon>
            <PenLineIcon className="h-4 w-4" />
          </FeatureIcon>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            <Trans>更优质的草稿</Trans>
          </ItemTitle>
          <ItemDescription>
            <Trans>回复时会了解发件人的套餐、工单和历史记录。</Trans>
          </ItemDescription>
        </ItemContent>
      </Item>
      {actionsEnabled && (
        <Item>
          <ItemMedia>
            <FeatureIcon>
              <ListChecksIcon className="h-4 w-4" />
            </FeatureIcon>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              <Trans>规则操作</Trans>
            </ItemTitle>
            <ItemDescription>
              <Trans>规则可以写回其他工具，例如添加 Todoist 任务。</Trans>
            </ItemDescription>
          </ItemContent>
        </Item>
      )}
    </ItemCard>
  );
}
