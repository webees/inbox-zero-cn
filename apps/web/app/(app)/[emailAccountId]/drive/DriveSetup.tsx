"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { ExternalLinkIcon, FolderIcon, PlusIcon } from "lucide-react";
import {
  TypographyH3,
  SectionDescription,
  TypographyP,
  TypographyH4,
  MutedText,
} from "@/components/Typography";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/Input";
import { toastSuccess, toastError } from "@/components/Toast";
import { FilingStatusCell } from "@/components/drive/FilingStatusCell";
import { YesNoIndicator } from "@/components/drive/YesNoIndicator";
import { TreeProvider, TreeView } from "@/components/kibo-ui/tree";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useEmailAccountFull } from "@/hooks/useEmailAccountFull";
import { useDriveConnections } from "@/hooks/useDriveConnections";
import { useDriveFolders } from "@/hooks/useDriveFolders";
import { useFilingPreviewAttachments } from "@/hooks/useFilingPreviewAttachments";
import {
  updateFilingPromptAction,
  updateFilingEnabledAction,
  moveFilingAction,
  fileAttachmentAction,
  submitPreviewFeedbackAction,
  type FileAttachmentFiled,
} from "@/utils/actions/drive";
import {
  updateFilingPromptBody,
  type UpdateFilingPromptBody,
} from "@/utils/actions/drive.validation";
import {
  CreateFolderDialog,
  FolderNode,
  NoFoldersFound,
} from "./AllowedFolders";
import { useFolderSelection } from "./use-folder-selection";
import type {
  FolderItem,
  SavedFolder,
} from "@/app/api/user/drive/folders/route";
import { DriveConnectionCard, getProviderInfo } from "./DriveConnectionCard";
import type { AttachmentPreviewItem } from "@/app/api/user/drive/preview/attachments/route";
import { LoadingContent } from "@/components/LoadingContent";
import { getEmailUrlForMessage } from "@/utils/url";
import { AlertBasic } from "@/components/Alert";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";

type SetupPhase = "setup" | "loading-attachments" | "preview" | "starting";

type FilingState = {
  status: "pending" | "filing" | "filed" | "skipped" | "error";
  result?: FileAttachmentFiled;
  error?: string;
  skipReason?: string;
  filingId?: string; // 已归档和已跳过的条目都会用到（用于反馈）
};

export function DriveSetup() {
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics("attachments");
  const { data: connectionsData } = useDriveConnections();
  const {
    data: foldersData,
    isLoading: foldersLoading,
    mutate: mutateFolders,
  } = useDriveFolders(emailAccountId);
  const { data: emailAccount, mutate: mutateEmail } = useEmailAccountFull();

  const connections = connectionsData?.connections || [];
  const connection = connections[0];
  const providerInfo = connection ? getProviderInfo(connection.provider) : null;

  const [userPhase, setUserPhase] = useState<
    "setup" | "previewing" | "starting"
  >("setup");
  const [filingStates, setFilingStates] = useState<Record<string, FilingState>>(
    {},
  );

  const shouldFetchAttachments =
    userPhase === "previewing" || userPhase === "starting";
  const { data: attachmentsData, isLoading: attachmentsLoading } =
    useFilingPreviewAttachments(shouldFetchAttachments, {
      onSuccess: (data) => {
        analytics.captureAction("auto_file_preview_completed", {
          attachment_count: data.attachments.length,
          no_attachments_found: data.noAttachmentsFound,
        });
        // 初始化状态并为每个附件触发归档
        const initial: Record<string, FilingState> = {};
        for (const att of data.attachments) {
          const key = `${att.messageId}-${att.filename}`;
          initial[key] = { status: "filing" };

          fileAttachmentAction(emailAccountId, {
            messageId: att.messageId,
            filename: att.filename,
          })
            .then((result) => {
              const resultData = result?.data;
              if (result?.serverError) {
                analytics.captureAction("auto_file_preview_item_failed", {
                  reason: "server_error",
                });
                setFilingStates((prev) => ({
                  ...prev,
                  [key]: { status: "error", error: result.serverError },
                }));
              } else if (resultData?.skipped) {
                analytics.captureAction("auto_file_preview_item_skipped");
                setFilingStates((prev) => ({
                  ...prev,
                  [key]: {
                    status: "skipped",
                    skipReason: resultData.skipReason,
                    filingId: resultData.filingId,
                  },
                }));
              } else if (resultData) {
                analytics.captureAction("auto_file_preview_item_filed");
                setFilingStates((prev) => ({
                  ...prev,
                  [key]: { status: "filed", result: resultData },
                }));
              } else {
                analytics.captureAction("auto_file_preview_item_failed", {
                  reason: "unknown",
                });
                setFilingStates((prev) => ({
                  ...prev,
                  [key]: { status: "error", error: "未知错误" },
                }));
              }
            })
            .catch((err) => {
              analytics.captureAction("auto_file_preview_item_failed", {
                reason: "exception",
              });
              setFilingStates((prev) => ({
                ...prev,
                [key]: {
                  status: "error",
                  error: err instanceof Error ? err.message : "归档失败",
                },
              }));
            });
        }
        setFilingStates(initial);
      },
      onError: (err) => {
        analytics.captureAction("auto_file_preview_failed");
        toastError({
          title: "获取预览时出错",
          description:
            err instanceof Error ? err.message : "加载最近的附件失败。请重试。",
        });
        setUserPhase("setup");
      },
    });

  const displayPhase = useMemo((): SetupPhase => {
    if (userPhase === "setup") return "setup";
    if (userPhase === "starting") return "starting";
    if (attachmentsLoading) return "loading-attachments";
    if (attachmentsData) return "preview";
    return "loading-attachments";
  }, [userPhase, attachmentsLoading, attachmentsData]);

  const handlePreviewClick = useCallback(() => {
    analytics.captureAction("auto_file_preview_started", {
      folder_count: foldersData?.savedFolders.length ?? 0,
      has_connection: Boolean(connection),
    });
    setUserPhase("previewing");
  }, [analytics, connection, foldersData?.savedFolders.length]);

  const handleStartFiling = useCallback(async () => {
    analytics.captureAction("auto_file_enable_started");
    setUserPhase("starting");
    try {
      const result = await updateFilingEnabledAction(emailAccountId, {
        filingEnabled: true,
      });

      if (result?.serverError) {
        analytics.captureAction("auto_file_enable_failed", {
          reason: "server_error",
        });
        toastError({
          title: "启动自动归档时出错",
          description: result.serverError,
        });
        setUserPhase("previewing");
        return;
      }

      analytics.captureAction("auto_file_enabled");
      toastSuccess({ description: "自动归档已启动！" });
      await mutateEmail();
    } catch (error) {
      analytics.captureAction("auto_file_enable_failed", {
        reason: "exception",
      });
      toastError({
        title: "启动自动归档时出错",
        description:
          error instanceof Error
            ? error.message
            : "启动自动归档时发生意外错误。",
      });
      setUserPhase("previewing");
    }
  }, [analytics, emailAccountId, mutateEmail]);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="text-center">
        <TypographyH3>让我们设置自动归档</TypographyH3>
        <SectionDescription className="mx-auto mt-3 max-w-xl">
          我们会把邮件中的附件归档到你的 {providerInfo?.name || "云端硬盘"}。
          <br />
          只需告诉我们归档到哪里、如何归档。
        </SectionDescription>
      </div>

      <div className="mt-6 flex justify-center">
        {connection ? (
          <DriveConnectionCard connection={connection} />
        ) : (
          <TypographyP>
            未找到云端硬盘连接。请连接你的云端硬盘以继续设置。
          </TypographyP>
        )}
      </div>

      <div className="mt-10 space-y-8">
        <SetupFolderSelection
          emailAccountId={emailAccountId}
          availableFolders={foldersData?.availableFolders || []}
          savedFolders={foldersData?.savedFolders || []}
          staleFolderCount={foldersData?.staleFolderDbIds.length || 0}
          connections={connections}
          mutateFolders={mutateFolders}
          isLoading={foldersLoading}
        />

        <SetupRulesForm
          emailAccountId={emailAccountId}
          initialPrompt={emailAccount?.filingPrompt || ""}
          mutateEmail={mutateEmail}
          hasFolders={foldersData ? foldersData.savedFolders.length > 0 : false}
          phase={displayPhase}
          onPreviewClick={handlePreviewClick}
        />

        {(displayPhase === "preview" || displayPhase === "starting") &&
          attachmentsData && (
            <PreviewContent
              emailAccountId={emailAccountId}
              attachments={attachmentsData.attachments}
              noAttachmentsFound={attachmentsData.noAttachmentsFound}
              savedFolders={foldersData?.savedFolders || []}
              filingStates={filingStates}
              onStartFiling={handleStartFiling}
              isStarting={displayPhase === "starting"}
            />
          )}
      </div>
    </div>
  );
}

function PreviewContent({
  emailAccountId,
  attachments,
  noAttachmentsFound,
  savedFolders,
  filingStates,
  onStartFiling,
  isStarting,
}: {
  emailAccountId: string;
  attachments: AttachmentPreviewItem[];
  noAttachmentsFound: boolean;
  savedFolders: SavedFolder[];
  filingStates: Record<string, FilingState>;
  onStartFiling: () => void;
  isStarting: boolean;
}) {
  if (noAttachmentsFound) {
    return (
      <NoAttachmentsMessage onSkip={onStartFiling} isStarting={isStarting} />
    );
  }

  return (
    <PreviewResults
      emailAccountId={emailAccountId}
      attachments={attachments}
      savedFolders={savedFolders}
      filingStates={filingStates}
      onStartFiling={onStartFiling}
      isStarting={isStarting}
    />
  );
}

function NoAttachmentsMessage({
  onSkip,
  isStarting,
}: {
  onSkip: () => void;
  isStarting: boolean;
}) {
  return (
    <div className="text-center">
      <MutedText className="mb-4">
        我们找不到最近带附件的邮件可供预览。
      </MutedText>
      <Button onClick={onSkip} loading={isStarting}>
        仍然启动自动归档
      </Button>
    </div>
  );
}

function PreviewResults({
  emailAccountId,
  attachments,
  savedFolders,
  filingStates,
  onStartFiling,
  isStarting,
}: {
  emailAccountId: string;
  attachments: AttachmentPreviewItem[];
  savedFolders: SavedFolder[];
  filingStates: Record<string, FilingState>;
  onStartFiling: () => void;
  isStarting: boolean;
}) {
  const { userEmail, provider } = useAccount();

  const allComplete = attachments.every((att) => {
    const key = `${att.messageId}-${att.filename}`;
    const status = filingStates[key]?.status;
    return status === "filed" || status === "skipped" || status === "error";
  });

  const anyFiling = attachments.some((att) => {
    const key = `${att.messageId}-${att.filename}`;
    return filingStates[key]?.status === "filing" || !filingStates[key];
  });

  const filedCount = attachments.filter((att) => {
    const key = `${att.messageId}-${att.filename}`;
    return filingStates[key]?.status === "filed";
  }).length;

  const skippedCount = attachments.filter((att) => {
    const key = `${att.messageId}-${att.filename}`;
    return filingStates[key]?.status === "skipped";
  }).length;

  const statusMessage = allComplete
    ? filedCount > 0
      ? `已归档 ${filedCount} 个附件${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ""}：`
      : `跳过 ${skippedCount} 个附件（不符合你的归档偏好）：`
    : `正在归档你最近的 ${attachments.length} 个附件…`;

  return (
    <div>
      <TypographyH4>3. 查看实际效果</TypographyH4>
      <MutedText className="mt-1">{statusMessage}</MutedText>

      <div className="mt-4 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>文件</TableHead>
              <TableHead>文件夹</TableHead>
              <TableHead className="w-[100px] text-right">归档正确？</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attachments.map((attachment) => {
              const key = `${attachment.messageId}-${attachment.filename}`;
              return (
                <FilingRow
                  key={key}
                  emailAccountId={emailAccountId}
                  attachment={attachment}
                  filingState={filingStates[key] || { status: "filing" }}
                  savedFolders={savedFolders}
                  userEmail={userEmail}
                  provider={provider}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        你的反馈能帮助我们学习
      </p>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Button
          onClick={onStartFiling}
          loading={isStarting}
          disabled={anyFiling}
        >
          {anyFiling ? "处理中…" : "看起来不错，启动自动归档"}
        </Button>
        <p className="text-xs text-muted-foreground">
          每次归档文件你都会收到邮件。回复即可纠正我们。
        </p>
      </div>
    </div>
  );
}

function FilingRow({
  emailAccountId,
  attachment,
  filingState,
  savedFolders,
  userEmail,
  provider,
}: {
  emailAccountId: string;
  attachment: AttachmentPreviewItem;
  filingState: FilingState;
  savedFolders: SavedFolder[];
  userEmail: string;
  provider: string;
}) {
  const analytics = useProductAnalytics("attachments");
  const [correctedPath, setCorrectedPath] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [vote, setVote] = useState<boolean | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const voteBeforeDropdownRef = useRef<boolean | null>(null);

  const folderPath = correctedPath ?? filingState.result?.folderPath ?? null;

  const handleMoveToFolder = useCallback(
    async (folder: SavedFolder) => {
      const filingId = filingState.result?.filingId;
      if (!filingId) return;

      setIsMoving(true);

      try {
        await moveFilingAction(emailAccountId, {
          filingId,
          targetFolderId: folder.folderId,
          targetFolderPath: folder.folderPath,
        });
        analytics.captureAction("auto_file_preview_item_moved");
        setCorrectedPath(folder.folderPath);
        toastSuccess({ description: `已移动到 ${folder.folderName}` });
      } catch {
        setVote(voteBeforeDropdownRef.current);
        toastError({ description: "移动文件失败" });
      } finally {
        setIsMoving(false);
      }
    },
    [analytics, emailAccountId, filingState.result?.filingId],
  );

  const handleCorrectClick = useCallback(async () => {
    const filingId = filingState.result?.filingId || filingState.filingId;
    if (!filingId) return;

    setVote(true);
    const result = await submitPreviewFeedbackAction(emailAccountId, {
      filingId,
      feedbackPositive: true,
    });

    if (result?.serverError) {
      setVote(null);
      toastError({ description: "提交反馈失败" });
    } else {
      analytics.captureAction("auto_file_preview_feedback_submitted", {
        feedback_positive: true,
        item_status: filingState.status,
      });
    }
  }, [
    analytics,
    emailAccountId,
    filingState.filingId,
    filingState.result?.filingId,
    filingState.status,
  ]);

  const handleWrongClick = useCallback(async () => {
    const filingId = filingState.result?.filingId;
    if (!filingId) return;

    setVote(false);
    const result = await submitPreviewFeedbackAction(emailAccountId, {
      filingId,
      feedbackPositive: false,
    });

    if (result?.serverError) {
      setVote(null);
      toastError({ description: "提交反馈失败" });
    } else {
      analytics.captureAction("auto_file_preview_feedback_submitted", {
        feedback_positive: false,
        item_status: filingState.status,
      });
    }
  }, [
    analytics,
    emailAccountId,
    filingState.result?.filingId,
    filingState.status,
  ]);

  const handleSkippedWrongClick = useCallback(async () => {
    const filingId = filingState.filingId;
    if (!filingId) return;

    setVote(false);
    const result = await submitPreviewFeedbackAction(emailAccountId, {
      filingId,
      feedbackPositive: false,
    });

    if (result?.serverError) {
      setVote(null);
      toastError({ description: "提交反馈失败" });
    } else {
      analytics.captureAction("auto_file_preview_feedback_submitted", {
        feedback_positive: false,
        item_status: filingState.status,
      });
    }
  }, [analytics, emailAccountId, filingState.filingId, filingState.status]);

  const isFiled = filingState.status === "filed";
  const isSkipped = filingState.status === "skipped";

  const otherFolders = savedFolders.filter((f) => f.folderPath !== folderPath);

  const emailUrl = getEmailUrlForMessage(
    attachment.messageId,
    attachment.threadId,
    userEmail,
    provider,
  );

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate max-w-[200px]">
            {attachment.filename}
          </span>
          <Link
            href={emailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            title="打开邮件"
          >
            <ExternalLinkIcon className="size-3.5" />
          </Link>
        </div>
      </TableCell>
      <TableCell className="break-words max-w-[200px]">
        <FilingStatusCell
          status={filingState.status}
          skipReason={filingState.skipReason}
          error={filingState.error}
          folderPath={folderPath}
        />
      </TableCell>
      <TableCell>
        {isFiled && otherFolders.length > 0 ? (
          <div className="flex items-center justify-end">
            <DropdownMenu
              onOpenChange={(open) => {
                setDropdownOpen(open);
                if (open) {
                  voteBeforeDropdownRef.current = vote;
                  setVote(false);
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <div>
                  <YesNoIndicator
                    value={vote}
                    onClick={(value) => {
                      if (value) handleCorrectClick();
                    }}
                    dropdownTrigger="wrong"
                    wrongActive={dropdownOpen}
                  />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>此文件应归入哪个文件夹？</DropdownMenuLabel>
                {otherFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.folderId}
                    disabled={isMoving}
                    onClick={() => handleMoveToFolder(folder)}
                  >
                    <FolderIcon className="size-4" />
                    {folder.folderName}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => setVote(voteBeforeDropdownRef.current)}
                >
                  取消
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : isFiled ? (
          <div className="flex items-center justify-end">
            <YesNoIndicator
              value={vote}
              onClick={(value) => {
                if (value) handleCorrectClick();
                else handleWrongClick();
              }}
            />
          </div>
        ) : isSkipped && filingState.filingId ? (
          <div className="flex items-center justify-end">
            <YesNoIndicator
              value={vote}
              onClick={(value) => {
                if (value) {
                  handleCorrectClick();
                } else {
                  handleSkippedWrongClick();
                }
              }}
            />
          </div>
        ) : (
          <div className="h-8" />
        )}
      </TableCell>
    </TableRow>
  );
}

function SetupFolderSelection({
  emailAccountId,
  availableFolders,
  savedFolders,
  staleFolderCount,
  connections,
  mutateFolders,
  isLoading,
}: {
  emailAccountId: string;
  availableFolders: FolderItem[];
  savedFolders: SavedFolder[];
  staleFolderCount: number;
  connections: Array<{ id: string; provider: string }>;
  mutateFolders: () => void;
  isLoading: boolean;
}) {
  const analytics = useProductAnalytics("attachments");
  // TODO：这里假设只有一个云端硬盘连接；当支持多连接 UX 后，改为使用选中的连接 ID。
  const driveConnectionId = connections[0]?.id ?? null;

  const onFoldersAdded = useCallback(
    (savedFolderCount: number) => {
      analytics.captureAction("auto_file_folder_selected", {
        saved_folder_count: savedFolderCount,
      });
    },
    [analytics],
  );
  const onFoldersRemoved = useCallback(
    (savedFolderCount: number) => {
      analytics.captureAction("auto_file_folder_removed", {
        saved_folder_count: savedFolderCount,
      });
    },
    [analytics],
  );

  const {
    optimisticFolderIds,
    childrenByParentId,
    rootFolders,
    handleFolderToggle,
    handleChildrenLoaded,
  } = useFolderSelection({
    emailAccountId,
    availableFolders,
    savedFolders,
    mutateFolders,
    onFoldersAdded,
    onFoldersRemoved,
  });

  return (
    <div>
      <TypographyH4>1. 选择你的文件夹</TypographyH4>
      <MutedText className="mt-1">
        我们可以归档到哪些文件夹？{" "}
        <span className="text-muted-foreground">
          （我们只会把文件放进你选择的文件夹）
        </span>
      </MutedText>
      {staleFolderCount > 0 && (
        <AlertBasic
          className="mt-4"
          variant="blue"
          title="检测到已删除的文件夹"
          description={`已从保存列表中移除 ${staleFolderCount} 个已删除的文件夹。`}
        />
      )}

      <LoadingContent loading={isLoading} error={undefined}>
        {rootFolders.length > 0 ? (
          <>
            <div className="mt-4">
              <TreeProvider
                showLines
                showIcons
                selectable={false}
                animateExpand
                indent={16}
              >
                <TreeView className="p-0">
                  {rootFolders.map((folder, index) => (
                    <FolderNode
                      key={folder.id}
                      folder={folder}
                      isLast={index === rootFolders.length - 1}
                      selectedFolderIds={optimisticFolderIds}
                      onToggle={handleFolderToggle}
                      level={0}
                      parentPath=""
                      childrenByParentId={childrenByParentId}
                      onChildrenLoaded={handleChildrenLoaded}
                      knownChildren={childrenByParentId.get(folder.id)}
                    />
                  ))}
                </TreeView>
              </TreeProvider>
            </div>
            <div className="mt-2">
              <CreateFolderDialog
                emailAccountId={emailAccountId}
                driveConnectionId={driveConnectionId}
                onFolderCreated={mutateFolders}
                triggerLabel="添加文件夹"
                triggerVariant="ghost"
                triggerSize="xs-2"
                triggerIcon={PlusIcon}
                triggerClassName="text-muted-foreground hover:text-foreground"
              />
            </div>
          </>
        ) : (
          <NoFoldersFound
            emailAccountId={emailAccountId}
            driveConnectionId={driveConnectionId}
            onFolderCreated={mutateFolders}
          />
        )}
      </LoadingContent>
    </div>
  );
}

function SetupRulesForm({
  emailAccountId,
  initialPrompt,
  mutateEmail,
  hasFolders,
  phase,
  onPreviewClick,
}: {
  emailAccountId: string;
  initialPrompt: string;
  mutateEmail: () => void;
  hasFolders: boolean;
  phase: SetupPhase;
  onPreviewClick: () => void;
}) {
  const analytics = useProductAnalytics("attachments");
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<UpdateFilingPromptBody>({
    resolver: zodResolver(updateFilingPromptBody),
    defaultValues: {
      filingPrompt: initialPrompt,
    },
  });

  const filingPrompt = watch("filingPrompt");
  const canPreview = (filingPrompt || "").trim().length > 0 && hasFolders;
  const isLoading = phase === "loading-attachments";
  const showPreviewButton =
    phase === "setup" || phase === "loading-attachments";

  const onSubmit: SubmitHandler<UpdateFilingPromptBody> = useCallback(
    async (data) => {
      if (!canPreview) {
        toastError({
          title: "设置未完成",
          description: "请至少选择一个文件夹，并描述你如何整理文件。",
        });
        return;
      }

      const result = await updateFilingPromptAction(emailAccountId, data);

      if (result?.serverError) {
        analytics.captureAction("auto_file_prompt_save_failed", {
          reason: "server_error",
        });
        toastError({
          title: "保存规则时出错",
          description: result.serverError,
        });
      } else {
        analytics.captureAction("auto_file_prompt_saved", {
          has_existing_prompt: Boolean(initialPrompt),
        });
        mutateEmail();
        // 保存成功后触发预览
        onPreviewClick();
      }
    },
    [
      analytics,
      canPreview,
      emailAccountId,
      initialPrompt,
      mutateEmail,
      onPreviewClick,
    ],
  );

  return (
    <div>
      <h3 className="text-lg font-semibold">2. 描述你如何整理文件</h3>
      <MutedText className="mt-1">用大白话告诉我们</MutedText>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
        <Input
          type="textarea"
          name="filingPrompt"
          placeholder={`合同按房产地址归入交易。
收据按月归入收据文件夹。`}
          registerProps={register("filingPrompt")}
          error={errors.filingPrompt}
          autosizeTextarea
          rows={3}
        />
        {errors.filingPrompt && (
          <p className="text-sm text-red-500">{errors.filingPrompt.message}</p>
        )}
        {showPreviewButton && (
          <div className="mt-10 text-center">
            <Button
              type="submit"
              disabled={!canPreview || isLoading}
              loading={isLoading}
            >
              {isLoading ? "正在查找最近的附件…" : "用我最近的邮件预览"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
