import prisma from "@/utils/prisma";
import { MutedText, PageHeading } from "@/components/Typography";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { auth } from "@/utils/auth";
import { getEmailTerminology } from "@/utils/terminology";
import type { RuleHistoryTrigger } from "@/utils/rule/rule-history";

const triggerTypeLabels: Record<RuleHistoryTrigger, string> = {
  created: "已创建",
  updated: "已更新",
  actions_updated: "操作已更新",
  conditions_updated: "条件已更新",
  instructions_updated: "指令已更新",
  enabled_updated: "启用状态已切换",
  run_on_threads_updated: "会话模式已更新",
};

export default async function RuleHistoryPage(props: {
  params: Promise<{ emailAccountId: string; ruleId: string }>;
}) {
  const { emailAccountId, ruleId } = await props.params;
  const session = await auth();
  if (!session?.user.id) notFound();

  const rule = await prisma.rule.findFirst({
    where: {
      id: ruleId,
      // 验证用户是否有权访问此邮箱账号
      emailAccount: {
        id: emailAccountId,
        userId: session.user.id,
      },
    },
    select: {
      id: true,
      name: true,
      emailAccount: {
        select: {
          account: { select: { provider: true } },
        },
      },
    },
  });
  if (!rule) notFound();

  const ruleHistory = await prisma.ruleHistory.findMany({
    where: {
      ruleId: rule.id,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div className="container mx-auto p-4">
      <PageHeading>规则历史：{rule.name}</PageHeading>
      {ruleHistory.length === 0 ? (
        <p className="mt-4 text-muted-foreground">未找到此规则的历史记录。</p>
      ) : (
        <div className="mt-6 space-y-4">
          {ruleHistory.map((history) => (
            <Card key={history.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    版本 {history.version}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {triggerTypeLabels[
                        history.triggerType as RuleHistoryTrigger
                      ] ?? history.triggerType}
                    </Badge>
                    <MutedText>
                      {formatDistanceToNow(history.createdAt, {
                        addSuffix: true,
                      })}
                    </MutedText>
                  </div>
                </div>
                {history.promptText && (
                  <CardDescription className="mt-2">
                    <strong>提示词：</strong> {history.promptText}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="mb-1 font-semibold">规则详情</h4>
                    <dl className="grid grid-cols-1 gap-1 text-sm">
                      <div className="flex gap-2">
                        <dt className="font-medium">名称：</dt>
                        <dd>{history.name}</dd>
                      </div>
                      {history.instructions && (
                        <div className="flex gap-2">
                          <dt className="font-medium">指令：</dt>
                          <dd>{history.instructions}</dd>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <dt className="font-medium">状态：</dt>
                        <dd>
                          {history.enabled ? "已启用" : "已禁用"}
                          {history.automate && " • 自动化"}
                          {history.runOnThreads && " • 在会话中运行"}
                        </dd>
                      </div>
                      {history.conditionalOperator && (
                        <div className="flex gap-2">
                          <dt className="font-medium">运算符：</dt>
                          <dd>{history.conditionalOperator}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  {(history.from ||
                    history.to ||
                    history.subject ||
                    history.body) && (
                    <div>
                      <h4 className="mb-1 font-semibold">静态条件</h4>
                      <dl className="grid grid-cols-1 gap-1 text-sm">
                        {history.from && (
                          <div className="flex gap-2">
                            <dt className="font-medium">发件人：</dt>
                            <dd className="font-mono">{history.from}</dd>
                          </div>
                        )}
                        {history.to && (
                          <div className="flex gap-2">
                            <dt className="font-medium">收件人：</dt>
                            <dd className="font-mono">{history.to}</dd>
                          </div>
                        )}
                        {history.subject && (
                          <div className="flex gap-2">
                            <dt className="font-medium">主题：</dt>
                            <dd className="font-mono">{history.subject}</dd>
                          </div>
                        )}
                        {history.body && (
                          <div className="flex gap-2">
                            <dt className="font-medium">正文：</dt>
                            <dd className="font-mono">{history.body}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {history.systemType && (
                    <div>
                      <h4 className="mb-1 font-semibold">系统类型</h4>
                      <p className="text-sm">{history.systemType}</p>
                    </div>
                  )}

                  {history.actions && (
                    <div>
                      <h4 className="mb-1 font-semibold">操作</h4>
                      <div className="space-y-1">
                        {(
                          history.actions as Array<
                            Record<string, string | undefined>
                          >
                        ).map((action, index) => (
                          <div key={index} className="text-sm">
                            <Badge variant="secondary" className="mr-2">
                              {action.type}
                            </Badge>
                            {action.label && (
                              <span>
                                {
                                  getEmailTerminology(
                                    rule.emailAccount.account.provider,
                                  ).label.action
                                }
                                : {action.label}
                              </span>
                            )}
                            {action.subject && (
                              <span>主题：{action.subject}</span>
                            )}
                            {action.content && (
                              <span>
                                内容：{action.content.slice(0, 50)}...
                              </span>
                            )}
                            {action.to && <span>收件人：{action.to}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
