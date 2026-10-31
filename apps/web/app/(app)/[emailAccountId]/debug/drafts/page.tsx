"use client";

import Link from "next/link";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading, TypographyP } from "@/components/Typography";
import { LoadingContent } from "@/components/LoadingContent";
import type { DraftActionsResponse } from "@/app/api/user/draft-actions/route";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShortDate } from "@/utils/date";
import { getGmailUrl } from "@/utils/url";
import { Badge } from "@/components/ui/badge";
import { useMessagesBatch } from "@/hooks/useMessagesBatch";
import { LoadingMiniSpinner } from "@/components/Loading";
import { isDefined } from "@/utils/types";
import { useAccount } from "@/providers/EmailAccountProvider";
import { BRAND_NAME } from "@/utils/branding";

export default function DebugDraftsPage() {
  const { data, isLoading, error } = useSWR<DraftActionsResponse>(
    "/api/user/draft-actions",
  );

  const {
    data: messagesData,
    isLoading: isMessagesLoading,
    error: messagesError,
  } = useMessagesBatch({
    ids: data?.executedActions
      .map((executedAction) => executedAction.draftSendLog?.sentMessageId)
      .filter(isDefined),
    parseReplies: true,
  });

  const { emailAccountId } = useAccount();

  return (
    <div className="container mx-auto py-6">
      <PageHeading className="mb-6">{`由 ${BRAND_NAME} 生成的草稿`}</PageHeading>

      <LoadingContent loading={isLoading} error={error}>
        {data?.executedActions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center p-6">
              <TypographyP>暂无草稿操作。</TypographyP>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>状态</TableHead>
                  <TableHead>查看</TableHead>
                  <TableHead>草稿</TableHead>
                  <TableHead>已发送</TableHead>
                  <TableHead>相似度</TableHead>
                  <TableHead>日期</TableHead>
                </TableRow>
                {data?.executedActions?.map((executedAction) => (
                  <TableRow key={executedAction.id}>
                    <TableCell>
                      <Badge
                        variant={
                          isDraftSentStatus(executedAction.draftStatus)
                            ? "default"
                            : "secondary"
                        }
                      >
                        {formatDraftStatus(executedAction.draftStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isDraftSentStatus(executedAction.draftStatus) &&
                      executedAction.draftSendLog?.sentMessageId ? (
                        <Link
                          href={getGmailUrl(
                            executedAction.draftSendLog.sentMessageId,
                            emailAccountId,
                          )}
                          target="_blank"
                          className="text-blue-500 hover:text-blue-600"
                        >
                          已发送邮件
                        </Link>
                      ) : executedAction.draftId ? (
                        <Link
                          href={getGmailUrl(
                            executedAction.draftId,
                            emailAccountId,
                          )}
                          target="_blank"
                          className="text-blue-500 hover:text-blue-600"
                        >
                          草稿
                        </Link>
                      ) : (
                        <span className="text-gray-500">不适用</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <TypographyP>{executedAction.content}</TypographyP>
                    </TableCell>
                    <TableCell>
                      <LoadingContent
                        loading={isMessagesLoading}
                        error={messagesError}
                        loadingComponent={<LoadingMiniSpinner />}
                      >
                        <TypographyP>
                          {messagesData?.messages.find(
                            (message) =>
                              message.id ===
                              executedAction.draftSendLog?.sentMessageId,
                          )?.textPlain || "-"}
                        </TypographyP>
                      </LoadingContent>
                    </TableCell>
                    <TableCell>
                      {executedAction.draftSendLog?.similarityScore !== null
                        ? executedAction.draftSendLog?.similarityScore.toFixed(
                            2,
                          )
                        : "不适用"}
                    </TableCell>
                    <TableCell>
                      {formatShortDate(new Date(executedAction.createdAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableHeader>
            </Table>
          </Card>
        )}
      </LoadingContent>
    </div>
  );
}

function formatDraftStatus(draftStatus?: string | null) {
  if (draftStatus) return draftStatus.replaceAll("_", " ");
  return "待处理";
}

function isDraftSentStatus(draftStatus?: string | null) {
  return draftStatus === "LIKELY_SENT";
}
