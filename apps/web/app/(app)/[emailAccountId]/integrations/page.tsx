"use client";

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
  const integrationsEnabled = useIntegrationsEnabled();
  const { tier, isLoading: isPremiumLoading } = usePremium();

  const hasAccess = hasTierAccess({
    tier: tier || null,
    minimumTier: "PLUS_MONTHLY",
  });

  // PostHog 初始化期间功能标志为 undefined
  if (integrationsEnabled === undefined) return null;

  if (!integrationsEnabled) {
    return (
      <PageWrapper>
        <div className="flex items-center justify-between gap-2">
          <PageHeader title="集成" description="连接你已经在使用的工具。" />
        </div>

        <div className="mt-8">
          <ActionCard
            variant="blue"
            icon={<ZapIcon className="h-5 w-5" />}
            title="集成未启用"
            description="此功能处于限量发布阶段。加入抢先体验以为你的账号启用集成。"
            action={
              <Button asChild variant="outline">
                <Link href="/early-access">加入抢先体验</Link>
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
        <PageHeader title="集成" description="连接你已经在使用的工具。" />
        {hasAccess && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
            <AddCustomMcpServerDialog />
            <RequestAccessDialog
              trigger={<Button variant="outline">请求集成</Button>}
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
          <ItemTitle>更好的草稿</ItemTitle>
          <ItemDescription>
            回复在起草时会了解发件人的套餐、工单和历史记录。
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
            <ItemTitle>规则操作</ItemTitle>
            <ItemDescription>
              规则可以执行写回操作，例如添加 Todoist 任务。
            </ItemDescription>
          </ItemContent>
        </Item>
      )}
    </ItemCard>
  );
}
