"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { type SubmitHandler, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { usePostHog } from "posthog-js/react";
import { env } from "@/env";
import { isDeleteEmailActionEnabled } from "@/utils/delete-email-action";
import { PencilIcon, TrashIcon, InboxIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";
import { TypographyH3 } from "@/components/Typography";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import {
  createRuleAction,
  deleteRuleAction,
  updateRuleAction,
} from "@/utils/actions/rule";
import {
  type CreateRuleBody,
  createRuleBody,
} from "@/utils/actions/rule.validation";
import { Toggle } from "@/components/Toggle";
import { Tooltip } from "@/components/Tooltip";
import { useLabels } from "@/hooks/useLabels";
import { useMessagingChannels } from "@/hooks/useMessagingChannels";
import { AlertError } from "@/components/Alert";
import { LearnedPatternsDialog } from "@/app/(app)/[emailAccountId]/assistant/group/LearnedPatterns";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { getEmailTerminology } from "@/utils/terminology";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/components/ui/collapsible";
import { Form } from "@/components/ui/form";
import { ACTION_TYPE_LABELS, getActionIcon } from "@/utils/action-display";
import { useFolders } from "@/hooks/useFolders";
import { isConversationStatusType } from "@/utils/reply-tracker/conversation-status-config";
import { RuleSectionCard } from "@/app/(app)/[emailAccountId]/assistant/RuleSectionCard";
import { ConditionSteps } from "@/app/(app)/[emailAccountId]/assistant/ConditionSteps";
import {
  ActionSteps,
  formatMessagingDestinationLabel,
} from "@/app/(app)/[emailAccountId]/assistant/ActionSteps";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMessagingProviderName } from "@/utils/messaging/platforms";
import { RuleLoader } from "@/app/(app)/[emailAccountId]/assistant/RuleLoader";
import {
  getAvailableActionsForRuleEditor,
  getExtraAvailableActionsForRuleEditor,
} from "@/utils/ai/rule/action-availability";
import { handleRuleAttachmentSourceSave } from "@/utils/attachments/rule";
import type { AttachmentSourceInput } from "@/utils/attachments/source-schema";
import type { GetMessagingChannelsResponse } from "@/app/api/user/messaging-channels/route";
import { usePremium } from "@/hooks/usePremium";
import { hasTierAccess } from "@/utils/premium";
import { shouldIncludeDigestAction } from "@/utils/premium/digest";
import { UpgradeToPlusButton } from "@/components/UpgradeToPlusButton";
import { useIntegrationActionsEnabled } from "@/hooks/useFeatureFlags";
import { getConnectedRuleNotificationChannels } from "@/utils/messaging/routes";
import { isDraftReplyActionType } from "@/utils/actions/draft-reply";
import {
  buildPersistedRuleActions,
  getRuleFormActionState,
} from "@/app/(app)/[emailAccountId]/assistant/ruleFormActions";

export function Rule({
  ruleId,
  alwaysEditMode = false,
}: {
  ruleId: string;
  alwaysEditMode?: boolean;
}) {
  return (
    <RuleLoader ruleId={ruleId}>
      {({ rule, mutate }) => (
        <RuleForm rule={rule} alwaysEditMode={alwaysEditMode} mutate={mutate} />
      )}
    </RuleLoader>
  );
}

export function RuleForm({
  rule,
  alwaysEditMode = false,
  onSuccess,
  isDialog = false,
  mutate,
  onCancel,
}: {
  rule: CreateRuleBody & {
    id?: string;
    attachmentSources?: Array<{
      driveConnectionId: string;
      name: string;
      sourceId: string;
      sourcePath: string | null;
      type: AttachmentSourceInput["type"];
    }>;
  };
  alwaysEditMode?: boolean;
  onSuccess?: () => void;
  isDialog?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  mutate?: (data?: any, options?: any) => void;
  onCancel?: () => void;
}) {
  const { emailAccountId, provider } = useAccount();
  const integrationActionsEnabled = useIntegrationActionsEnabled();
  const { tier, isLoading: isLoadingPremium } = usePremium();
  const hasDigestAccess = hasTierAccess({
    tier,
    minimumTier: "PLUS_MONTHLY",
  });
  const ruleFormActionState = getRuleFormActionState({
    actions: rule.actions,
    webhookActionsEnabled: env.NEXT_PUBLIC_WEBHOOK_ACTION_ENABLED !== false,
  });

  const form = useForm<CreateRuleBody>({
    resolver: zodResolver(createRuleBody),
    defaultValues: rule
      ? {
          ...rule,
          digest: ruleFormActionState.digest,
          notifyMessagingChannelId:
            ruleFormActionState.notifyMessagingChannelId,
          actions: ruleFormActionState.actions,
        }
      : undefined,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState,
    trigger,
  } = form;

  const { errors, isSubmitting, isSubmitted } = formState;

  const {
    fields: conditionFields,
    append: appendCondition,
    remove: removeCondition,
  } = useFieldArray({
    control,
    name: "conditions",
  });
  const {
    fields: actionFields,
    append,
    remove,
    replace,
  } = useFieldArray({ control, name: "actions" });

  const { userLabels, isLoading, mutate: mutateLabels } = useLabels();
  const { data: messagingChannelsData } = useMessagingChannels(emailAccountId);
  const { folders, isLoading: foldersLoading } = useFolders(provider);
  const router = useRouter();

  const posthog = usePostHog();
  const [attachmentSources, setAttachmentSources] = useState<
    AttachmentSourceInput[]
  >(
    rule.attachmentSources?.map((source) => ({
      driveConnectionId: source.driveConnectionId,
      name: source.name,
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      type: source.type,
    })) || [],
  );

  const onSubmit: SubmitHandler<CreateRuleBody> = useCallback(
    async (data) => {
      const existingDigestAction = rule.actions.find(
        (action) => action.type === ActionType.DIGEST,
      );
      const includeDigestAction = shouldIncludeDigestAction({
        digestFeatureEnabled: !!env.NEXT_PUBLIC_DIGEST_ENABLED,
        hasDigestAccess,
        wantsDigest: !!data.digest,
        hasExistingDigest: !!existingDigestAction,
      });
      const actionsToSubmit = buildPersistedRuleActions({
        formActions: data.actions,
        originalActions: rule.actions,
        includeDigestAction,
        notifyMessagingChannelId: data.notifyMessagingChannelId,
        webhookActionsEnabled: env.NEXT_PUBLIC_WEBHOOK_ACTION_ENABLED !== false,
      });
      const hasDraftAction = actionsToSubmit.some((action) =>
        isDraftReplyActionType(action.type),
      );

      if (data.id) {
        if (mutate) {
          const optimisticData = {
            rule: {
              ...rule,
              actions: actionsToSubmit,
            },
          };
          mutate(optimisticData, false);
        }

        const res = await updateRuleAction(emailAccountId, {
          ...data,
          actions: actionsToSubmit,
          id: data.id,
        });

        if (res?.serverError) {
          console.error(res);
          toastError({ description: res.serverError });
          if (mutate) mutate();
        } else if (!res?.data?.rule) {
          toastError({
            description: "更新规则时出错。",
          });
          if (mutate) mutate();
        } else {
          await handleRuleAttachmentSourceSave({
            emailAccountId,
            ruleId: res.data.rule.id,
            attachmentSources,
            shouldSave: hasDraftAction,
            successMessage: "已保存！",
            partialErrorMessage: "规则已保存，但无法更新草稿附件来源。",
          });

          // Revalidate to get the real data from server
          if (mutate) mutate();
          posthog.capture("User updated AI rule", {
            conditions: data.conditions.map((condition) => condition.type),
            actions: actionsToSubmit.map((action) => action.type),
            runOnThreads: data.runOnThreads,
            digest: data.digest,
          });
          if (isDialog && onSuccess) {
            onSuccess();
          } else {
            router.push(prefixPath(emailAccountId, "/automation?tab=rules"));
          }
        }
      } else {
        const res = await createRuleAction(emailAccountId, {
          ...data,
          actions: actionsToSubmit,
        });

        if (res?.serverError) {
          console.error(res);
          toastError({ description: res.serverError });
        } else if (!res?.data?.rule) {
          toastError({
            description: "创建规则时出错。",
          });
        } else {
          await handleRuleAttachmentSourceSave({
            emailAccountId,
            ruleId: res.data.rule.id,
            attachmentSources,
            shouldSave: hasDraftAction,
            successMessage: "已创建！",
            partialErrorMessage: "规则已创建，但无法保存草稿附件来源。",
          });

          posthog.capture("User created AI rule", {
            conditions: data.conditions.map((condition) => condition.type),
            actions: actionsToSubmit.map((action) => action.type),
            runOnThreads: data.runOnThreads,
            digest: data.digest,
          });
          if (isDialog && onSuccess) {
            onSuccess();
          } else {
            router.replace(
              prefixPath(emailAccountId, `/assistant/rule/${res.data.rule.id}`),
            );
            router.push(prefixPath(emailAccountId, "/automation?tab=rules"));
          }
        }
      }
    },
    [
      attachmentSources,
      router,
      posthog,
      emailAccountId,
      isDialog,
      onSuccess,
      mutate,
      rule,
      hasDigestAccess,
    ],
  );

  const conditions = watch("conditions");

  // biome-ignore lint/correctness/useExhaustiveDependencies: needed
  useEffect(() => {
    trigger("conditions");
  }, [conditions]);

  const actionErrors = useMemo(() => {
    const actionErrors: string[] = [];
    watch("actions")?.forEach((_, index) => {
      const actionError =
        formState.errors?.actions?.[index]?.url?.root?.message ||
        formState.errors?.actions?.[index]?.labelId?.root?.message ||
        formState.errors?.actions?.[index]?.to?.root?.message ||
        formState.errors?.actions?.[index]?.messagingChannelId?.message ||
        formState.errors?.actions?.[index]?.integrationArgs?.message ||
        formState.errors?.actions?.[index]?.integrationArgs?.root?.message;
      // react-hook-form 会把嵌套 record 的 message 拓宽为 string | FieldError
      if (typeof actionError === "string") actionErrors.push(actionError);
    });
    return actionErrors;
  }, [formState, watch]);

  const conditionalOperator = watch("conditionalOperator");
  const terminology = getEmailTerminology(provider);
  const existingActionTypes = useMemo(
    () => ruleFormActionState.editableActionTypes,
    [ruleFormActionState.editableActionTypes],
  );

  const formErrors = useMemo(
    () =>
      Object.values(formState.errors)
        .filter((error): error is { message: string } => Boolean(error.message))
        .map((error) => error.message),
    [formState],
  );

  const typeOptions = useMemo(
    () =>
      getRuleActionTypeOptions({
        provider,
        labelActionText: terminology.label.action,
        systemType: rule.systemType,
        existingActionTypes,
        integrationActionsEnabled,
      }).map((option) => ({
        ...option,
        icon: getActionIcon(option.value),
      })),
    [
      existingActionTypes,
      integrationActionsEnabled,
      provider,
      terminology.label.action,
      rule.systemType,
    ],
  );

  const [isNameEditMode, setIsNameEditMode] = useState(alwaysEditMode);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const toggleNameEditMode = useCallback(() => {
    if (!alwaysEditMode) {
      setIsNameEditMode((prev: boolean) => !prev);
    }
  }, [alwaysEditMode]);

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-10">
        {isSubmitted && formErrors.length > 0 && (
          <div className="mt-4">
            <AlertError
              title="错误"
              description={
                <ul className="list-disc">
                  {formErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              }
            />
          </div>
        )}

        <div>
          {isNameEditMode ? (
            <Input
              type="text"
              name="name"
              label="规则名称"
              registerProps={register("name")}
              error={errors.name}
              placeholder="例如：给收据打标签"
            />
          ) : (
            <TypographyH3
              onClick={toggleNameEditMode}
              className="group flex cursor-pointer items-center"
            >
              {watch("name")}
              <PencilIcon className="ml-2 size-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </TypographyH3>
          )}
        </div>

        <RuleSectionCard
          icon={InboxIcon}
          color="blue"
          title="当我收到邮件时"
          className="!mt-6"
          errors={
            errors.conditions?.root?.message ? (
              <AlertError
                title="错误"
                description={errors.conditions.root.message}
              />
            ) : undefined
          }
        >
          <ConditionSteps
            conditionFields={conditionFields}
            conditionalOperator={conditionalOperator}
            removeCondition={removeCondition}
            watch={watch}
            setValue={setValue}
            register={register}
            errors={errors}
            conditions={conditions}
            ruleSystemType={rule.systemType}
            appendCondition={appendCondition}
          />
        </RuleSectionCard>

        <RuleSectionCard
          icon={ZapIcon}
          color="green"
          title="然后"
          errors={
            actionErrors.length > 0 ? (
              <AlertError
                title="错误"
                description={
                  <ul className="list-inside list-disc">
                    {actionErrors.map((error, index) => (
                      <li key={`action-${index}`}>{error}</li>
                    ))}
                  </ul>
                }
              />
            ) : undefined
          }
        >
          <ActionSteps
            actionFields={actionFields}
            register={register}
            watch={watch}
            setValue={setValue}
            append={append}
            remove={remove}
            replaceActions={replace}
            control={control}
            errors={errors}
            userLabels={userLabels}
            isLoading={isLoading}
            mutate={mutateLabels}
            emailAccountId={emailAccountId}
            typeOptions={typeOptions}
            folders={folders}
            foldersLoading={foldersLoading}
            messagingChannels={messagingChannelsData?.channels ?? []}
            availableMessagingProviders={
              messagingChannelsData?.availableProviders ?? []
            }
            attachmentSources={attachmentSources}
            onAttachmentSourcesChange={setAttachmentSources}
          />
        </RuleSectionCard>

        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleHeading>高级选项</CollapsibleHeading>
          <CollapsibleContent>
            {isAdvancedOpen ? (
              <div className="rounded-md border divide-y">
                <AdvancedRow
                  title="应用于会话"
                  description="对会话中的每一封回复都执行，而不仅是第一封邮件。"
                >
                  <Tooltip
                    content="此规则类型无法更改该项。"
                    hide={allowMultipleConditions(rule.systemType)}
                  >
                    <span>
                      <Toggle
                        name="runOnThreads"
                        enabled={watch("runOnThreads") || false}
                        onChange={(enabled) => {
                          setValue("runOnThreads", enabled);
                        }}
                        disabled={!allowMultipleConditions(rule.systemType)}
                      />
                    </span>
                  </Tooltip>
                </AdvancedRow>

                {env.NEXT_PUBLIC_DIGEST_ENABLED && (
                  <AdvancedRow
                    title="纳入邮件摘要"
                    description={
                      !hasDigestAccess && watch("digest")
                        ? "邮件摘要需使用 Plus 套餐。关闭该项即可在你当前的套餐下更新此规则。"
                        : "在邮件摘要中显示匹配的邮件。"
                    }
                  >
                    {isLoadingPremium ? null : hasDigestAccess ||
                      watch("digest") ? (
                      <Toggle
                        name="digest"
                        enabled={watch("digest") || false}
                        onChange={(enabled) => {
                          setValue("digest", enabled);
                        }}
                      />
                    ) : (
                      <UpgradeToPlusButton tooltip="升级到 Plus 套餐即可将邮件纳入你的邮件摘要。" />
                    )}
                  </AdvancedRow>
                )}

                <NotifyChannelRow
                  channels={messagingChannelsData?.channels ?? []}
                  availableProviders={
                    messagingChannelsData?.availableProviders ?? []
                  }
                  emailAccountId={emailAccountId}
                  value={watch("notifyMessagingChannelId") ?? null}
                  onChange={(channelId) => {
                    setValue("notifyMessagingChannelId", channelId);
                  }}
                  hasDraftToChat={watch("actions")?.some(
                    (action) =>
                      action.type === ActionType.DRAFT_MESSAGING_CHANNEL,
                  )}
                />

                {!!rule.id && (
                  <AdvancedRow
                    title="学习到的模式"
                    description="根据你的修正推断出的模式。"
                  >
                    <Tooltip
                      content="此规则类型不支持学习到的模式。"
                      hide={!isConversationStatusType(rule.systemType)}
                    >
                      <span>
                        <LearnedPatternsDialog
                          ruleId={rule.id}
                          groupId={rule.groupId || null}
                          disabled={isConversationStatusType(rule.systemType)}
                          label="查看"
                        />
                      </span>
                    </Tooltip>
                  </AdvancedRow>
                )}

                {rule.id && !rule.systemType && (
                  <AdvancedRow title="删除规则" description="永久移除此规则。">
                    <Button
                      size="sm"
                      variant="outline"
                      Icon={TrashIcon}
                      loading={isDeleting}
                      disabled={isSubmitting}
                      onClick={async () => {
                        const yes = confirm("你确定要删除此规则吗？");
                        if (yes) {
                          try {
                            setIsDeleting(true);
                            const result = await deleteRuleAction(
                              emailAccountId,
                              {
                                id: rule.id!,
                              },
                            );
                            if (result?.serverError) {
                              toastError({
                                description: result.serverError,
                              });
                            } else {
                              toastSuccess({
                                description: "规则已删除。",
                              });

                              if (isDialog && onSuccess) {
                                onSuccess();
                              }

                              router.push(
                                prefixPath(
                                  emailAccountId,
                                  "/automation?tab=rules",
                                ),
                              );
                            }
                          } catch {
                            toastError({
                              description: "删除规则失败。",
                            });
                          } finally {
                            setIsDeleting(false);
                          }
                        }
                      }}
                    >
                      删除
                    </Button>
                  </AdvancedRow>
                )}
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end space-x-2 !mt-6">
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
          )}

          {rule.id ? (
            <Button
              type="submit"
              size="sm"
              loading={isSubmitting}
              disabled={isDeleting}
            >
              保存
            </Button>
          ) : (
            <Button type="submit" size="sm" loading={isSubmitting}>
              创建
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}

const CONNECT_SENTINEL = "__connect__";

function NotifyChannelRow({
  channels,
  availableProviders,
  emailAccountId,
  value,
  onChange,
  hasDraftToChat,
}: {
  channels: GetMessagingChannelsResponse["channels"];
  availableProviders: GetMessagingChannelsResponse["availableProviders"];
  emailAccountId: string;
  value: string | null;
  onChange: (channelId: string | null) => void;
  hasDraftToChat?: boolean;
}) {
  const router = useRouter();
  const connectedChannels = getConnectedRuleNotificationChannels(channels);
  const hasChannels = connectedChannels.length > 0;
  const canConnect = availableProviders.length > 0;

  if (!hasChannels && !canConnect) return null;
  const selectedChannelIsConnected =
    !value || connectedChannels.some((channel) => channel.id === value);
  const selectValue = selectedChannelIsConnected ? (value ?? "off") : "off";

  const channelsPath = prefixPath(emailAccountId, "/channels");
  const draftsNote = hasDraftToChat
    ? "草稿也会发送到聊天——在上方操作中配置。"
    : undefined;

  if (!hasChannels) {
    return (
      <AdvancedRow
        title="在聊天中通知"
        description="当此规则匹配时发送一条消息。"
        note={draftsNote}
      >
        <Button asChild variant="outline" size="sm">
          <Link href={channelsPath}>连接</Link>
        </Button>
      </AdvancedRow>
    );
  }

  const channelsByProvider = new Map<
    GetMessagingChannelsResponse["channels"][number]["provider"],
    GetMessagingChannelsResponse["channels"]
  >();
  for (const channel of connectedChannels) {
    const list = channelsByProvider.get(channel.provider) ?? [];
    list.push(channel);
    channelsByProvider.set(channel.provider, list);
  }
  const showGroups = channelsByProvider.size > 1;

  return (
    <AdvancedRow
      title="在聊天中通知"
      description="当此规则匹配时发送一条消息。"
      note={draftsNote}
    >
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === CONNECT_SENTINEL) {
            router.push(channelsPath);
            return;
          }
          onChange(next === "off" ? null : next);
        }}
      >
        <SelectTrigger className="w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">关闭</SelectItem>
          {showGroups
            ? Array.from(channelsByProvider.entries()).map(
                ([provider, providerChannels]) => (
                  <SelectGroup key={provider}>
                    <SelectLabel>
                      {getMessagingProviderName(provider)}
                    </SelectLabel>
                    {providerChannels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {formatMessagingDestinationLabel(channel)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ),
              )
            : connectedChannels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  {formatMessagingDestinationLabel(channel)}
                </SelectItem>
              ))}
          {canConnect ? (
            <>
              <SelectSeparator />
              <SelectItem value={CONNECT_SENTINEL}>+ 连接新频道</SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>
    </AdvancedRow>
  );
}

function AdvancedRow({
  title,
  description,
  children,
  note,
}: {
  title: string;
  description: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function allowMultipleConditions(systemType: SystemType | null | undefined) {
  return (
    systemType !== SystemType.COLD_EMAIL &&
    !isConversationStatusType(systemType)
  );
}

type ActionTypeOption = {
  label: string;
  value: ActionType;
  dividerBefore?: boolean;
};

export function getRuleActionTypeOptions({
  provider,
  labelActionText,
  systemType,
  existingActionTypes,
  integrationActionsEnabled,
}: {
  provider: string;
  labelActionText: string;
  systemType: SystemType | null | undefined;
  existingActionTypes: ActionType[];
  integrationActionsEnabled: boolean;
}): ActionTypeOption[] {
  const availableActions = new Set(
    getAvailableActionsForRuleEditor({
      provider,
      existingActionTypes,
    }),
  );
  const extraActions = new Set(
    getExtraAvailableActionsForRuleEditor({
      existingActionTypes,
      integrationActionsEnabled,
    }),
  );

  return [
    {
      label: labelActionText,
      value: ActionType.LABEL,
    },
    ...(availableActions.has(ActionType.MOVE_FOLDER)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.MOVE_FOLDER],
            value: ActionType.MOVE_FOLDER,
          },
        ]
      : []),
    ...(availableActions.has(ActionType.DRAFT_EMAIL)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.DRAFT_EMAIL],
            value: ActionType.DRAFT_EMAIL,
          },
        ]
      : []),
    {
      label: ACTION_TYPE_LABELS[ActionType.ARCHIVE],
      value: ActionType.ARCHIVE,
    },
    ...(isDeleteEmailActionEnabled() ||
    existingActionTypes.includes(ActionType.DELETE)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.DELETE],
            value: ActionType.DELETE,
          },
        ]
      : []),
    {
      label: ACTION_TYPE_LABELS[ActionType.MARK_READ],
      value: ActionType.MARK_READ,
    },
    {
      label: ACTION_TYPE_LABELS[ActionType.STAR],
      value: ActionType.STAR,
    },
    ...(availableActions.has(ActionType.REPLY)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.REPLY],
            value: ActionType.REPLY,
          },
        ]
      : []),
    ...(availableActions.has(ActionType.SEND_EMAIL)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.SEND_EMAIL],
            value: ActionType.SEND_EMAIL,
          },
        ]
      : []),
    ...(availableActions.has(ActionType.FORWARD)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.FORWARD],
            value: ActionType.FORWARD,
          },
        ]
      : []),
    {
      label: ACTION_TYPE_LABELS[ActionType.MARK_SPAM],
      value: ActionType.MARK_SPAM,
    },
    ...(extraActions.has(ActionType.CALL_WEBHOOK)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.CALL_WEBHOOK],
            value: ActionType.CALL_WEBHOOK,
          },
        ]
      : []),
    ...(extraActions.has(ActionType.INTEGRATION)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.INTEGRATION],
            value: ActionType.INTEGRATION,
            dividerBefore: true,
          },
        ]
      : []),
    ...((systemType === SystemType.COLD_EMAIL &&
      env.NEXT_PUBLIC_IS_RESEND_CONFIGURED) ||
    existingActionTypes.includes(ActionType.NOTIFY_SENDER)
      ? [
          {
            label: ACTION_TYPE_LABELS[ActionType.NOTIFY_SENDER],
            value: ActionType.NOTIFY_SENDER,
          },
        ]
      : []),
  ];
}
