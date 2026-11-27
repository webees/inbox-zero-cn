"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import useSWR from "swr";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TypographyP } from "@/components/Typography";
import { ViewLearnedPatterns } from "@/app/(app)/[emailAccountId]/assistant/group/ViewLearnedPatterns";
import type { GroupsResponse } from "@/app/api/user/group/route";
import { LoadingContent } from "@/components/LoadingContent";

export function LearnedPatternsSetting() {
  const { t } = useLingui();

  return (
    <SettingCard
      title={t`已学习的模式`}
      description={t`查看助手从你的邮件历史中学到的模式。`}
      right={
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trans>查看</Trans>
            </Button>
          </DialogTrigger>
          {/* Scroll inside the content row (not DialogContent itself) so the close button stays visible */}
          <DialogContent className="max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                <Trans>已学习的模式</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>
                  当 AI
                  处理你的邮件时，它会学习哪些发件人或邮件类型始终匹配相同的规则。例如，它可能会学习到来自
                  newsletter@example.com
                  的邮件总是匹配你的“Newsletter”规则。这些已学习的模式能帮助 AI
                  随着时间推移做出更快、更准确的决策。你可以查看、编辑或删除已学习的模式。
                </Trans>
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 overflow-y-auto">
              <Content />
            </div>
          </DialogContent>
        </Dialog>
      }
    />
  );
}

function Content() {
  const { data, isLoading, error } = useSWR<GroupsResponse>("/api/user/group");

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data?.groups.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <TypographyP>
              <Trans>尚未找到已学习的模式。</Trans>
            </TypographyP>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {data?.groups.map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>
                  {group.rule?.name || <Trans>无规则</Trans>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ViewLearnedPatterns groupId={group.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </LoadingContent>
  );
}
