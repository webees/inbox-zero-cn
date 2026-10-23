"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import useSWR from "swr";
import { useAction } from "next-safe-action/hooks";
import { CommentComposer } from "@/components/team-comments/CommentComposer";
import { ConversationDiscussion } from "@/components/team-comments/ConversationDiscussion";
import { ShareConversationDialog } from "@/components/team-comments/ShareConversationDialog";
import {
  postCommentAction,
  shareConversationAction,
} from "@/utils/actions/team-comments";
import type { TeamConversationsResponse } from "@/app/api/team-comments/conversations/route";

export function PublisherDiscussion({
  emailAccountId,
  threadId,
}: {
  emailAccountId: string;
  threadId: string;
}) {
  // 已共享的会话始终显示其评论；未共享的会话保持隐藏，
  // 直到从菜单、命令面板或快捷键打开发表框。
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    const openComposer = () => {
      setOpen(true);
      setFocusRequest((request) => request + 1);
    };
    document.addEventListener("team-comments:open", openComposer);
    return () =>
      document.removeEventListener("team-comments:open", openComposer);
  }, []);
  const { executeAsync: share } = useAction(shareConversationAction);
  const { executeAsync: postComment } = useAction(postCommentAction);
  const memberships = useSWR<TeamConversationsResponse>(
    "/api/team-comments/conversations",
  );
  const memberId = memberships.data?.memberships.find(
    (membership) => membership.emailAccount.id === emailAccountId,
  )?.id;
  const url = memberId
    ? `/api/team-comments/conversations?memberId=${encodeURIComponent(memberId)}&emailAccountId=${encodeURIComponent(emailAccountId)}&threadId=${encodeURIComponent(threadId)}`
    : null;
  const source = useSWR<TeamConversationsResponse>(url);
  // 只有在成员关系和共享状态加载完成后才会渲染发表框。
  const composerReady = Boolean(memberId && source.data);
  useEffect(() => {
    if (!focusRequest || !composerReady) return;
    const focus = () => {
      const composer = document.getElementById("internal-comment");
      composer?.focus();
      composer?.scrollIntoView({ block: "nearest" });
    };
    focus();
    // 菜单或命令面板关闭后，会在退出动画结束时把焦点交还给其触发器，
    // 因此除非用户已经移开焦点，否则再次聚焦。
    const timeout = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.tagName === "BUTTON")
        focus();
    }, 300);
    return () => clearTimeout(timeout);
  }, [focusRequest, composerReady]);
  if (!memberId || !source.data) return null;
  const sharedSource = source.data.source;
  const teammates = source.data.teammates;
  return (
    <div className="mt-6" data-testid="publisher-discussion">
      {sharedSource ? (
        <ConversationDiscussion
          key={`${memberId}:${sharedSource.id}:${sharedSource.generation}`}
          memberId={memberId}
          conversationId={sharedSource.id}
          onStopped={() => {
            setOpen(false);
            source.mutate();
          }}
        />
      ) : open && teammates.length ? (
        <div className="border-t pt-4 pb-6">
          <CommentComposer
            candidates={teammates.map((teammate) => ({
              memberId: teammate.id,
              name: teammate.emailAccount.name ?? teammate.emailAccount.email,
            }))}
            participantIds={[]}
            requireMention
            hint={
              <>
                <span>评论绝不会作为邮件发送。@提及队友以共享此会话。</span>
                <span className="flex shrink-0 items-center">
                  <ShareConversationDialog
                    memberId={memberId}
                    emailAccountId={emailAccountId}
                    threadId={threadId}
                    teammates={teammates}
                    onShared={() => source.mutate()}
                  />
                  <Button
                    size="icon2xs"
                    variant="ghost"
                    aria-label="关闭评论"
                    onClick={() => setOpen(false)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </span>
              </>
            }
            onSubmit={async (comment) => {
              const shared = await share({
                memberId,
                source: { emailAccountId, threadId },
                participantMemberIds: comment.mentionedMemberIds,
              });
              if (!shared?.data) return shared;
              const result = await postComment({
                memberId,
                conversationId: shared.data.id,
                ...comment,
              });
              if (result?.data) source.mutate();
              return result;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
