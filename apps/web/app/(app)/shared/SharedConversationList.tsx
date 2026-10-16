"use client";

import Link from "next/link";
import useSWR from "swr";
import { LoadingContent } from "@/components/LoadingContent";
import { Badge } from "@/components/ui/badge";
import type { TeamConversationsResponse } from "@/app/api/team-comments/conversations/route";
import {
  NoOrganization,
  useSharedMemberId,
} from "@/app/(app)/shared/SharedTabs";

export function SharedConversationList() {
  const { memberId, memberships } = useSharedMemberId();
  const conversations = useSWR<TeamConversationsResponse>(
    memberId
      ? `/api/team-comments/conversations?memberId=${encodeURIComponent(memberId)}`
      : null,
    { refreshInterval: 30_000 },
  );
  return (
    <LoadingContent
      loading={memberships.isLoading || conversations.isLoading}
      error={
        (memberships.data ? undefined : memberships.error) ||
        (conversations.data ? undefined : conversations.error)
      }
    >
      {memberships.data && !memberId && <NoOrganization />}
      {memberId && (
        <div className="space-y-2">
          {!conversations.data?.conversations.length && (
            <p className="text-muted-foreground text-sm">还没有共享的会话。</p>
          )}
          {conversations.data?.conversations.map((conversation) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
              key={conversation.id}
              href={`/shared/${conversation.id}?memberId=${encodeURIComponent(memberId)}`}
            >
              <span>
                <span className="block font-medium">
                  由 {conversation.publisher} 共享的会话
                </span>
                <span className="text-muted-foreground text-xs">
                  {conversation.commentCount} 条评论 ·{" "}
                  {new Date(conversation.updatedAt).toLocaleString()}
                </span>
              </span>
              {conversation.unread && <Badge>未读</Badge>}
            </Link>
          ))}
        </div>
      )}
    </LoadingContent>
  );
}
