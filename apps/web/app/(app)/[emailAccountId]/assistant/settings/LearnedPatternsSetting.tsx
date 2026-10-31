"use client";

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
  return (
    <SettingCard
      title="学习模式"
      description="查看助手从你的邮件历史中学习到的模式。"
      right={
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              查看
            </Button>
          </DialogTrigger>
          {/* 在内容行内滚动（而非 DialogContent 本身），以便关闭按钮保持可见 */}
          <DialogContent className="max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <DialogHeader>
              <DialogTitle>学习模式</DialogTitle>
              <DialogDescription>
                当 AI
                处理你的邮件时，它会学习哪些发件人或邮件类型总是匹配相同的规则。例如，它可能学习到来自
                newsletter@example.com
                的邮件总是匹配你的“Newsletter”规则。这些学习模式帮助 AI
                随着时间推移做出更快、更准确的决策。你可以查看、编辑或删除已学习到的模式。
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
            <TypographyP>尚未找到学习模式。</TypographyP>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {data?.groups.map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>{group.rule?.name || "无规则"}</CardTitle>
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
