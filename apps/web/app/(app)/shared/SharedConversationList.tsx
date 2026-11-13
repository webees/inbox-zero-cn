"use client";

import { Plural, Trans } from "@lingui/react/macro";
import Link from "next/link";
import useSWR from "swr";
import { LoadingContent } from "@/components/LoadingContent";
import { Badge } from "@/components/ui/badge";
import { SharedEmptyState } from "@/app/(app)/shared/SharedEmptyState";
import type { TeamConversationsResponse } from "@/app/api/team-comments/conversations/route";
import { NoOrganization } from "@/app/(app)/shared/SharedTabs";
import { useTeamMembership } from "@/components/team-comments/use-team-nav";

export function SharedConversationList() {
  const { memberId, memberships } = useTeamMembership();
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
          {!conversations.data?.conversations.length && <SharedEmptyState />}
          {conversations.data?.conversations.map((conversation) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
              key={conversation.id}
              href={`/shared/${conversation.id}?memberId=${encodeURIComponent(memberId)}`}
            >
              <span>
                <span className="block font-medium">
                  <Trans>{conversation.publisher} 分享的会话</Trans>
                </span>
                <span className="text-muted-foreground text-xs">
                  <Plural
                    value={conversation.commentCount}
                    one="# 条评论"
                    other="# 条评论"
                  />{" "}
                  · {new Date(conversation.updatedAt).toLocaleString()}
                </span>
              </span>
              {conversation.unread && (
                <Badge>
                  <Trans>未读</Trans>
                </Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </LoadingContent>
  );
}
