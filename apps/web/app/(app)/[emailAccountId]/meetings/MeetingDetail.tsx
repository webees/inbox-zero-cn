"use client";

import { useAccount } from "@/providers/EmailAccountProvider";
import { type ReactNode, useState } from "react";
import { format } from "date-fns";
import {
  ChevronDownIcon,
  MailPlusIcon,
  MoreHorizontalIcon,
  TextQuoteIcon,
  Trash2Icon,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useSWRConfig } from "swr";
import { LoadingContent } from "@/components/LoadingContent";
import { MutedText } from "@/components/Typography";
import { toastError, toastSuccess } from "@/components/Toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBlue, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getMeetingDetailState } from "@/app/(app)/[emailAccountId]/meetings/meeting-detail-state";
import { useMeetingRecorderMeeting } from "@/hooks/useMeetingRecorder";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import { deleteMeetingNotesAction } from "@/utils/actions/meeting-recorder";
import { getActionErrorMessage } from "@/utils/error";
import { formatTranscriptTimestamp } from "@/utils/meeting-recorder/transcript-prompt";
import { getAccountScopedKey } from "@/utils/swr";

export function MeetingDetail({
  meetingId,
  onClose,
}: {
  meetingId: string | null;
  onClose: () => void;
}) {
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics();
  const { mutate } = useSWRConfig();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const {
    data,
    isLoading,
    error,
    mutate: mutateMeeting,
  } = useMeetingRecorderMeeting(meetingId, emailAccountId);

  const summary = data?.summary;
  const transcript = data?.recording?.transcript;

  const state = getMeetingDetailState({
    hasSummary: !!summary,
    hasTranscript: !!transcript?.length,
    recordingStatus: data?.recording?.status,
    processingStatus: data?.processingStatus,
  });
  const { execute: deleteNotes, isExecuting: isDeleting } = useAction(
    deleteMeetingNotesAction.bind(null, emailAccountId),
    {
      onSuccess: async () => {
        await Promise.all([
          mutateMeeting(undefined, { revalidate: false }),
          mutate(
            getAccountScopedKey(
              "/api/user/meeting-recorder/meetings",
              emailAccountId,
            ),
          ),
        ]);
        toastSuccess({ description: "会议笔记已删除。" });
        setIsDeleteOpen(false);
        onClose();
      },
      onError: ({ error: actionError }) => {
        toastError({
          description: getActionErrorMessage(actionError, {
            prefix: "删除会议笔记失败",
          }),
        });
      },
    },
  );

  return (
    <Dialog open={!!meetingId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="space-y-1.5">
              <DialogTitle>{data?.eventTitle ?? "会议"}</DialogTitle>
              {data && (
                <DialogDescription>
                  {formatMeetingTimeRange(data.startTime, data.endTime)}
                </DialogDescription>
              )}
            </div>
            {data?.recording && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="会议选项"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setIsDeleteOpen(true)}
                  >
                    <Trash2Icon className="mr-2 size-4" />
                    删除笔记
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </DialogHeader>

        <LoadingContent
          loading={isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-64 w-full" />}
        >
          {state === "recording-failed" && (
            <Alert variant="destructive">
              <AlertTitle>此会议未被录制</AlertTitle>
              <AlertDescription>
                {data?.recording?.failureReason}
              </AlertDescription>
            </Alert>
          )}

          {state === "processing-failed" && (
            <Alert variant="destructive">
              <AlertTitle>无法生成笔记</AlertTitle>
              <AlertDescription>
                录制内容还在，但生成摘要一直失败。下方仍可查看转录文本。
              </AlertDescription>
            </Alert>
          )}

          {state === "notes-unavailable" && (
            <Alert>
              <AlertTitle>未创建摘要</AlertTitle>
              <AlertDescription>
                {transcript?.length
                  ? "下方仍可查看转录文本。"
                  : "此会议没有可用的转录文本。"}
              </AlertDescription>
            </Alert>
          )}

          {state === "processing" && (
            <MutedText>
              录制内容正在处理中。笔记准备好后会显示在这里。
            </MutedText>
          )}

          {state === "not-recorded" && (
            <MutedText>此会议尚未被录制。</MutedText>
          )}

          {!summary && state === "notes" && (
            <MutedText>摘要仍在撰写中。</MutedText>
          )}

          {summary && (
            <>
              <DetailSection title="摘要">
                <p className="text-sm leading-relaxed">{summary.overview}</p>
                <SummaryList items={summary.keyDecisions} title="决策" />
              </DetailSection>

              {summary.actionItems.length > 0 && (
                <DetailSection title="行动事项">
                  <ul className="space-y-2">
                    {summary.actionItems.map((item, index) => (
                      <li
                        key={`action-${index}`}
                        className="flex items-start justify-between gap-3 text-sm"
                      >
                        <span>{item.description}</span>
                        {item.owner && (
                          <Badge variant="secondary" className="shrink-0">
                            {item.owner}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}

              {!!(
                summary.openQuestions?.length || summary.nextSteps?.length
              ) && (
                <DetailSection title="待解决">
                  <SummaryList
                    items={summary.openQuestions ?? []}
                    title="待解决问题"
                  />
                  <SummaryList
                    items={summary.nextSteps ?? []}
                    title="后续步骤"
                  />
                </DetailSection>
              )}
            </>
          )}

          {data?.followUpDraftId && (
            <CardBlue>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <MailPlusIcon className="size-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium">跟进草稿已就绪</span>
                </div>
                <MutedText>
                  它已存放在你的草稿中，收件人是其他参会者。没有替你发送任何内容。
                </MutedText>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={getFollowUpDraftUrl(data.id, emailAccountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      analytics.captureAction(
                        "meeting_recorder_follow_up_draft_opened",
                      )
                    }
                  >
                    前往草稿
                  </a>
                </Button>
              </CardContent>
            </CardBlue>
          )}

          {!!transcript?.length && (
            <Collapsible defaultOpen>
              <Card>
                <CollapsibleTrigger className="group flex w-full items-center gap-3 p-4 text-left hover:bg-accent/50">
                  <TextQuoteIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">转录文本</span>
                  <span className="flex-1 text-sm text-muted-foreground">
                    {transcript.length} 行
                  </span>
                  <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="max-h-[40vh] space-y-3 overflow-y-auto border-t p-4">
                    {transcript.map((utterance, index) => (
                      <div key={`${utterance.startTime}-${index}`}>
                        <p className="text-xs font-medium text-muted-foreground">
                          {utterance.speakerName} ·{" "}
                          {formatTranscriptTimestamp(utterance.startTime)}
                        </p>
                        <p className="text-sm">{utterance.text}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {data?.recapSentAt && (
            <MutedText className="text-xs">
              笔记已通过邮件发送{" "}
              {format(new Date(data.recapSentAt), "MMM d 'at' h:mm a")}
            </MutedText>
          )}
        </LoadingContent>

        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除会议笔记？</AlertDialogTitle>
              <AlertDialogDescription>
                摘要和转录文本将从 Inbox Zero
                中永久删除。已发送的回顾邮件和邮箱中的跟进草稿会保留。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting || !meetingId}
                onClick={(event) => {
                  event.preventDefault();
                  if (meetingId) deleteNotes({ meetingId });
                }}
              >
                {isDeleting ? "正在删除…" : "删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-medium">{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="text-sm">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function getFollowUpDraftUrl(meetingId: string, emailAccountId: string) {
  return `/api/user/meeting-recorder/meetings/${encodeURIComponent(meetingId)}/draft?emailAccountId=${encodeURIComponent(emailAccountId)}`;
}

function formatMeetingTimeRange(
  startTime: string | Date,
  endTime: string | Date,
) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  return `${format(start, "EEE, MMM d")} · ${format(start, "h:mm")} – ${format(end, "h:mm a")}`;
}
