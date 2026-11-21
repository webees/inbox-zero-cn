"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutosizeTextarea } from "@/components/ui/textarea";
import { useIsOnline } from "@/hooks/useIsOnline";
import { getActionErrorMessage } from "@/utils/error";
import {
  getMentionedMemberIds,
  type MentionCandidate,
} from "@/utils/team-comments/mentions";

type SubmitResult =
  | (Parameters<typeof getActionErrorMessage>[0] & { data?: unknown })
  | undefined;

export function CommentComposer({
  candidates,
  participantIds,
  requireMention = false,
  hint,
  onSubmit,
}: {
  candidates: MentionCandidate[];
  participantIds: string[];
  requireMention?: boolean;
  hint?: ReactNode;
  onSubmit: (comment: {
    body: string;
    mentionedMemberIds: string[];
    clientMutationId: string;
  }) => Promise<SubmitResult>;
}) {
  const { t, i18n } = useLingui();
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [mutationId, setMutationId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const online = useIsOnline();
  const mentioned = getMentionedMemberIds(body, candidates, picked);
  const mentionQuery = body.match(/(?:^|\s)@([^\s@]*)$/)?.[1]?.toLowerCase();
  const suggestions =
    mentionQuery === undefined
      ? []
      : candidates.filter(
          (candidate) =>
            !mentioned.includes(candidate.memberId) &&
            candidate.name.toLowerCase().includes(mentionQuery),
        );
  const newlyShared = candidates.filter(
    (candidate) =>
      mentioned.includes(candidate.memberId) &&
      !participantIds.includes(candidate.memberId),
  );
  const canSubmit =
    online &&
    !isSubmitting &&
    Boolean(body.trim()) &&
    (!requireMention || mentioned.length > 0);
  const selectMention = (candidate: MentionCandidate) => {
    setBody((current) =>
      current.replace(
        /(?:^|\s)@([^\s@]*)$/,
        (match) =>
          `${match.startsWith("@") ? "" : match[0]}@${candidate.name} `,
      ),
    );
    setPicked((current) => [...current, candidate.memberId]);
    setHighlighted(0);
  };
  const submit = async () => {
    if (!canSubmit) return;
    setError("");
    setIsSubmitting(true);
    const result = await onSubmit({
      body,
      mentionedMemberIds: mentioned,
      clientMutationId: mutationId,
    }).catch(() => undefined);
    setIsSubmitting(false);
    if (result?.data) {
      setBody("");
      setPicked([]);
      setMutationId(crypto.randomUUID());
    } else setError(getActionErrorMessage(result ?? {}));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((current) => (current + 1) % suggestions.length);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted(
          (current) => (current - 1 + suggestions.length) % suggestions.length,
        );
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMention(suggestions[highlighted] ?? suggestions[0]);
      }
    }
  };
  const newlySharedNames = new Intl.ListFormat(i18n.locale, {
    type: "conjunction",
  }).format(newlyShared.map((candidate) => candidate.name));
  const notice = newlyShared.length ? (
    <span>
      <Trans>
        发送后还会将此会话中所有过去和未来的消息共享给{" "}
        <span className="font-medium text-foreground">{newlySharedNames}</span>.
      </Trans>
    </span>
  ) : (
    hint
  );
  return (
    <div className="space-y-1.5">
      {notice && (
        <div className="flex items-center justify-between gap-2 px-1 text-muted-foreground text-xs">
          {notice}
        </div>
      )}
      <div className="relative">
        {suggestions.length > 0 && (
          <div
            id="comment-mentions"
            role="listbox"
            aria-label={t`提及队友`}
            className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border bg-popover p-1 shadow-md"
          >
            {suggestions.map((candidate, index) => (
              <button
                type="button"
                id={`comment-mention-${candidate.memberId}`}
                tabIndex={-1}
                role="option"
                aria-selected={index === highlighted}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm aria-selected:bg-accent"
                key={candidate.memberId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(candidate)}
              >
                {candidate.name}
                {!participantIds.includes(candidate.memberId) && (
                  <span className="text-muted-foreground text-xs">
                    <Trans>尚未共享</Trans>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border bg-background py-1.5 pr-1.5 pl-3 transition-[box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <label className="sr-only" htmlFor="internal-comment">
            <Trans>内部评论</Trans>
          </label>
          <AutosizeTextarea
            id="internal-comment"
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-0 focus-visible:ring-0"
            minRows={1}
            maxRows={10}
            maxLength={10_000}
            placeholder={t`评论并 @提及队友`}
            value={body}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              const next = event.target.value;
              setBody(next);
              // 选择仅在提及其仍在文本中时有效；否则重新输入有歧义的名字会复用它。
              setPicked((current) => {
                const stillMentioned = getMentionedMemberIds(
                  next,
                  candidates,
                  current,
                );
                return current.filter((id) => stillMentioned.includes(id));
              });
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={suggestions.length ? "comment-mentions" : undefined}
            aria-activedescendant={
              suggestions.length
                ? `comment-mention-${(suggestions[highlighted] ?? suggestions[0]).memberId}`
                : undefined
            }
          />
          <Button
            size="iconXs"
            className="rounded-full"
            variant={canSubmit ? "default" : "ghost"}
            disabled={!canSubmit}
            aria-label={error ? t`Retry comment` : t`Post comment`}
            onClick={submit}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </div>
      </div>
      {!online && (
        <p className="px-1 text-muted-foreground text-xs" role="status">
          <Trans>Offline. Reconnect to post your comment.</Trans>
        </p>
      )}
      {error && (
        <p className="px-1 text-destructive text-xs" role="alert">
          <Trans>{error} Your draft is saved here; retry when ready.</Trans>
        </p>
      )}
    </div>
  );
}
