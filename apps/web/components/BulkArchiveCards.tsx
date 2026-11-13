"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import groupBy from "lodash/groupBy";
import type { I18n } from "@lingui/core";
import { plural, t as coreT } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { CheckIcon, ChevronDownIcon, MailIcon, PencilIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonCheckbox } from "@/components/ButtonCheckbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmailCell } from "@/components/EmailCell";
import { changeSenderCategoryAction } from "@/utils/actions/categorize";
import { toastError, toastSuccess } from "@/components/Toast";
import { ButtonLoader } from "@/components/Loading";
import { useThreads } from "@/hooks/useThreads";
import { formatShortDate } from "@/utils/date";
import { cn } from "@/utils";
import {
  useArchiveSenderStatus,
  useArchiveSenderQueueActions,
} from "@/store/archive-sender-queue";
import {
  addToMarkReadSenderQueue,
  useMarkReadSenderStatus,
} from "@/store/mark-read-sender-queue";
import {
  addToDeleteSenderQueue,
  useDeleteSenderStatus,
} from "@/store/delete-sender-queue";
import {
  type BulkActionType,
  getActionLabels,
} from "@/app/(app)/[emailAccountId]/bulk-archive/BulkArchiveSettingsModal";
import { getEmailUrl } from "@/utils/url";
import type { CategoryWithRules } from "@/utils/category.server";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getCategoryStyle } from "@/components/bulk-archive/categoryIcons";
import { defaultCategory } from "@/utils/categories";
import type { EmailGroup } from "@/utils/bulk-archive/get-archive-candidates";

export function BulkArchiveCards({
  emailGroups,
  categories,
  bulkAction,
  onCategoryChange,
}: {
  emailGroups: EmailGroup[];
  categories: CategoryWithRules[];
  bulkAction: BulkActionType;
  onCategoryChange?: () => Promise<unknown>;
}) {
  const { t, i18n } = useLingui();
  const { emailAccountId, userEmail } = useAccount();
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [expandedCategory, setExpandedCategory] = useQueryState("expanded");
  const [expandedSenders, setExpandedSenders] = useState<
    Record<string, boolean>
  >({});
  const [archivedCategories, setArchivedCategories] = useState<
    Record<string, boolean>
  >({});
  const [loadingCategories, setLoadingCategories] = useState<
    Record<string, boolean>
  >({});
  const [selectedSenders, setSelectedSenders] = useState<
    Record<string, boolean>
  >({});

  const categoryMap = useMemo(
    () =>
      categories.reduce<Record<string, CategoryWithRules>>((acc, category) => {
        acc[category.name] = category;
        return acc;
      }, {}),
    [categories],
  );

  // 获取默认分类的名称，以确定哪些分类应显示为单独的标签页
  const defaultCategoryNames = useMemo(
    () => new Set<string>(Object.values(defaultCategory).map((c) => c.name)),
    [],
  );

  const groupedEmails = useMemo(() => {
    const grouped = groupBy(emailGroups, (group) => {
      const categoryName =
        categoryMap[group.category?.name || ""]?.name || "Uncategorized";

      // 如果分类不是默认分类之一，就将其归入“其他”
      // 这处理了 4+其他分类体系之前的旧分类
      if (
        categoryName !== "Uncategorized" &&
        !defaultCategoryNames.has(categoryName)
      ) {
        return defaultCategory.OTHER.name;
      }

      return categoryName;
    });

    // 始终显示默认分类（即使没有发件人）
    for (const cat of Object.values(defaultCategory)) {
      if (!grouped[cat.name]) {
        grouped[cat.name] = [];
      }
    }

    return grouped;
  }, [emailGroups, categoryMap, defaultCategoryNames]);

  // 按字母顺序排序分类，但始终将“其他”和“未分类”放在最后
  const sortedCategoryEntries = useMemo(
    () =>
      Object.entries(groupedEmails).sort(([a], [b]) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        if (a === defaultCategory.OTHER.name) return 1;
        if (b === defaultCategory.OTHER.name) return -1;
        return a.localeCompare(b);
      }),
    [groupedEmails],
  );

  const toggleCategory = (categoryName: string) => {
    if (expandedCategory !== categoryName) {
      initializeSenders(categoryName);
    }
    setExpandedCategory(
      expandedCategory === categoryName ? null : categoryName,
    );
  };

  const toggleSender = (senderAddress: string) => {
    setExpandedSenders((prev) => ({
      ...prev,
      [senderAddress]: !prev[senderAddress],
    }));
  };

  const initializeSenders = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    const newSelected = { ...selectedSenders };
    for (const sender of senders) {
      if (newSelected[sender.address] === undefined) {
        newSelected[sender.address] = true;
      }
    }
    setSelectedSenders(newSelected);
  };

  const toggleSenderSelection = (senderAddress: string) => {
    setSelectedSenders((prev) => ({
      ...prev,
      [senderAddress]: prev[senderAddress] === false,
    }));
  };

  const getSelectedCount = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    return senders.filter((s) => selectedSenders[s.address] !== false).length;
  };

  const areAllSelectedInCategory = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    if (senders.length === 0) return false;
    return senders.every((s) => selectedSenders[s.address] !== false);
  };

  const areSomeSelectedInCategory = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    const selectedCount = getSelectedCount(categoryName);
    return selectedCount > 0 && selectedCount < senders.length;
  };

  const selectAllInCategory = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    setSelectedSenders((prev) => {
      const newSelected = { ...prev };
      for (const sender of senders) {
        newSelected[sender.address] = true;
      }
      return newSelected;
    });
  };

  const deselectAllInCategory = (categoryName: string) => {
    const senders = groupedEmails[categoryName] || [];
    setSelectedSenders((prev) => {
      const newSelected = { ...prev };
      for (const sender of senders) {
        newSelected[sender.address] = false;
      }
      return newSelected;
    });
  };

  const toggleSelectAllInCategory = (categoryName: string) => {
    if (areAllSelectedInCategory(categoryName)) {
      deselectAllInCategory(categoryName);
    } else {
      selectAllInCategory(categoryName);
    }
  };

  const actionLabels = getActionLabels(bulkAction, i18n);

  const handleCategoryAction = async (
    categoryName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const senders = groupedEmails[categoryName] || [];
    const selectedToProcess = senders.filter(
      (s) => selectedSenders[s.address] !== false,
    );

    if (
      bulkAction === "delete" &&
      selectedToProcess.length > 0 &&
      !window.confirm(
        t`${plural(selectedToProcess.length, {
          one: "Delete emails from # sender? This action cannot be undone.",
          other: "Delete emails from # senders? This action cannot be undone.",
        })}`,
      )
    ) {
      return;
    }

    setLoadingCategories((prev) => ({ ...prev, [categoryName]: true }));

    try {
      let failedToQueue = false;
      for (const sender of selectedToProcess) {
        try {
          if (bulkAction === "markRead") {
            await addToMarkReadSenderQueue({
              sender: sender.address,
              emailAccountId,
            });
          }

          if (bulkAction === "delete") {
            await addToDeleteSenderQueue({
              sender: sender.address,
              emailAccountId,
            });
          }
        } catch {
          failedToQueue = true;
        }
      }

      if (failedToQueue) throw new Error("部分发件人操作未能加入队列");

      if (bulkAction === "archive") {
        await queueArchiveSenders({
          senders: selectedToProcess.map((sender) => sender.address),
        });
      }

      if (bulkAction !== "archive") {
        setArchivedCategories((prev) => ({ ...prev, [categoryName]: true }));
      }
    } catch {
      toastError({
        description: getBulkActionFailedMessage(bulkAction, i18n),
      });
    } finally {
      setLoadingCategories((prev) => ({ ...prev, [categoryName]: false }));
    }
  };

  return (
    <div className="space-y-3 py-4">
      {sortedCategoryEntries.map(([categoryName, senders]) => {
        const category = categoryMap[categoryName];
        const categoryStyle = getCategoryStyle(categoryName);
        const CategoryIcon = categoryStyle.icon;

        // Get default category info if no category exists
        const defaultCat = Object.values(defaultCategory).find(
          (c) => c.name === categoryName,
        );

        // Skip if no category found and not a default category (but allow Uncategorized)
        if (!category && !defaultCat && categoryName !== "Uncategorized")
          return null;

        const isExpanded = expandedCategory === categoryName;
        const isArchived = archivedCategories[categoryName];
        const isLoading = loadingCategories[categoryName];
        const selectedCount = getSelectedCount(categoryName);

        return (
          <Card key={categoryName} className="overflow-hidden">
            {/* Category header - clickable to expand */}
            <div
              className="cursor-pointer p-4 transition-colors hover:bg-muted/50"
              onClick={() => toggleCategory(categoryName)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCategory(categoryName);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "shrink-0 p-px rounded-lg shadow-sm bg-gradient-to-b",
                      categoryStyle.borderColor,
                      isArchived && "opacity-50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-9 items-center justify-center rounded-[7px] bg-gradient-to-b",
                        categoryStyle.gradient,
                      )}
                    >
                      <CategoryIcon
                        className={cn("size-5", categoryStyle.iconColor)}
                      />
                    </div>
                  </div>
                  <div>
                    <h2
                      className={cn(
                        "font-medium",
                        isArchived && "text-muted-foreground line-through",
                      )}
                    >
                      {categoryName === "Uncategorized"
                        ? t`未分类`
                        : categoryName}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {isArchived ? (
                        <CompletedSenderCount
                          count={senders.length}
                          bulkAction={bulkAction}
                        />
                      ) : (
                        <Plural
                          value={senders.length}
                          one="# sender"
                          other="# senders"
                        />
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isArchived ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckIcon className="size-5" />
                      <span className="text-sm font-medium">
                        {actionLabels.completedLabel}
                      </span>
                    </div>
                  ) : (
                    <Button
                      onClick={(e) => handleCategoryAction(categoryName, e)}
                      size="sm"
                      disabled={isLoading}
                      variant={
                        bulkAction === "delete" ? "destructive" : "default"
                      }
                    >
                      {isLoading ? (
                        <ButtonLoader />
                      ) : (
                        <actionLabels.icon className="mr-2 size-4" />
                      )}
                      {isExpanded || selectedCount < senders.length
                        ? actionLabels.countLabel(selectedCount, senders.length)
                        : actionLabels.allLabel}
                    </Button>
                  )}
                  <ChevronDownIcon
                    className={cn(
                      "size-5 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </div>
              </div>
            </div>

            {/* 展开的发件人列表 */}
            {isExpanded && (
              <div className="border-t">
                <div className="divide-y">
                  {senders.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      <Trans>此分类中没有发件人</Trans>
                    </div>
                  ) : (
                    <>
                      {/* 全选行 */}
                      <div className="flex items-center gap-3 bg-muted/30 px-4 py-3">
                        <ButtonCheckbox
                          label={t`选择 ${categoryName} 中的所有发件人`}
                          checked={areAllSelectedInCategory(categoryName)}
                          indeterminate={areSomeSelectedInCategory(
                            categoryName,
                          )}
                          onChange={() =>
                            toggleSelectAllInCategory(categoryName)
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          <Trans>
                            已选择 {selectedCount}/{senders.length}
                          </Trans>
                        </span>
                      </div>
                      {senders.map((sender) => (
                        <SenderRow
                          key={sender.address}
                          sender={sender}
                          isExpanded={!!expandedSenders[sender.address]}
                          isSelected={selectedSenders[sender.address] !== false}
                          onToggle={() => toggleSender(sender.address)}
                          onToggleSelection={() =>
                            toggleSenderSelection(sender.address)
                          }
                          userEmail={userEmail}
                          categories={categories}
                          emailAccountId={emailAccountId}
                          bulkAction={bulkAction}
                          onCategoryChange={onCategoryChange}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SenderRow({
  sender,
  isExpanded,
  isSelected,
  onToggle,
  onToggleSelection,
  userEmail,
  categories,
  emailAccountId,
  bulkAction,
  onCategoryChange,
}: {
  sender: EmailGroup;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onToggleSelection: () => void;
  userEmail: string;
  categories: CategoryWithRules[];
  emailAccountId: string;
  bulkAction: BulkActionType;
  onCategoryChange?: () => Promise<unknown>;
}) {
  const archiveStatus = useArchiveSenderStatus(emailAccountId, sender.address);
  const markReadStatus = useMarkReadSenderStatus(
    emailAccountId,
    sender.address,
  );
  const deleteStatus = useDeleteSenderStatus(emailAccountId, sender.address);
  const { t } = useLingui();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const senderName = sender.name || sender.address;

  return (
    <div>
      {/* Sender row */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <ButtonCheckbox
          label={t`选择 ${senderName}`}
          checked={isSelected}
          onChange={() => onToggleSelection()}
        />
        <div className="min-w-0 flex-1">
          <EmailCell
            emailAddress={sender.address}
            name={sender.name}
            className="min-w-0"
            singleLine
          />
        </div>
        <div className="mr-2 text-right">
          <SenderStatus
            bulkAction={bulkAction}
            archiveStatus={archiveStatus}
            markReadStatus={markReadStatus}
            deleteStatus={deleteStatus}
          />
        </div>
        <Button
          variant="ghostMuted"
          size="iconSm"
          onClick={(e) => {
            e.stopPropagation();
            setEditDialogOpen(true);
          }}
        >
          <PencilIcon className="size-4" />
          <span className="sr-only">
            <Trans>编辑分类</Trans>
          </span>
        </Button>
        <ChevronDownIcon
          className={cn(
            "size-5 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </div>

      {/* 展开的邮件列表 */}
      {isExpanded && (
        <ExpandedEmails sender={sender.address} userEmail={userEmail} />
      )}

      {/* 编辑分类对话框 */}
      <EditCategoryDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        sender={sender}
        categories={categories}
        emailAccountId={emailAccountId}
        onCategoryChange={onCategoryChange}
      />
    </div>
  );
}

function EditCategoryDialog({
  open,
  onOpenChange,
  sender,
  categories,
  emailAccountId,
  onCategoryChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sender: EmailGroup;
  categories: CategoryWithRules[];
  emailAccountId: string;
  onCategoryChange?: () => Promise<unknown>;
}) {
  const { t } = useLingui();
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    sender.category?.id || "",
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (!selectedCategoryId) return;

    setIsLoading(true);
    const result = await changeSenderCategoryAction(emailAccountId, {
      sender: sender.address,
      categoryId: selectedCategoryId,
    });

    if (result?.serverError) {
      toastError({ description: result.serverError });
      setIsLoading(false);
    } else {
      toastSuccess({ description: t`分类已更新` });
      await onCategoryChange?.();
      setIsLoading(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sender.name || sender.address}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-8">
            <div className="space-y-1">
              <p className="font-medium">
                <Trans>分类</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>选择此发件人所属的分类</Trans>
              </p>
            </div>
            <Select
              value={selectedCategoryId}
              onValueChange={setSelectedCategoryId}
            >
              <SelectTrigger className="w-[180px] shrink-0">
                <SelectValue placeholder={t`选择分类`} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              <Trans>取消</Trans>
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? <Trans>保存中...</Trans> : <Trans>保存</Trans>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SenderStatus({
  bulkAction,
  archiveStatus,
  markReadStatus,
  deleteStatus,
}: {
  bulkAction: BulkActionType;
  archiveStatus: ReturnType<typeof useArchiveSenderStatus>;
  markReadStatus: ReturnType<typeof useMarkReadSenderStatus>;
  deleteStatus: ReturnType<typeof useDeleteSenderStatus>;
}) {
  if (bulkAction === "delete" && deleteStatus?.status) {
    return <DeleteSenderStatus status={deleteStatus} />;
  }

  if (bulkAction === "markRead" && markReadStatus?.status) {
    return <MarkReadSenderStatus status={markReadStatus} />;
  }

  if (bulkAction === "archive" && archiveStatus?.status) {
    return <ArchiveSenderStatus status={archiveStatus} />;
  }

  if (archiveStatus?.status) {
    return <ArchiveSenderStatus status={archiveStatus} />;
  }

  if (markReadStatus?.status) {
    return <MarkReadSenderStatus status={markReadStatus} />;
  }

  if (deleteStatus?.status) {
    return <DeleteSenderStatus status={deleteStatus} />;
  }

  return null;
}

function ArchiveSenderStatus({
  status,
}: {
  status: ReturnType<typeof useArchiveSenderStatus>;
}) {
  switch (status?.status) {
    case "pending":
      return (
        <span className="text-sm text-muted-foreground">
          <Trans>已排队</Trans>
        </span>
      );
    case "processing":
      return (
        <span className="text-sm text-blue-600">
          {status.threadsTotal ? (
            `${status.threadsTotal - status.threadIds.length} / ${status.threadsTotal}`
          ) : (
            <Trans>正在归档...</Trans>
          )}
        </span>
      );
    case "completed":
      return (
        <span className="text-sm text-green-600">
          {status.threadsTotal ? (
            <Plural
              value={status.threadsTotal}
              one="已归档 # 个会话"
              other="已归档 # 个会话"
            />
          ) : (
            <Trans>已归档</Trans>
          )}
        </span>
      );
    case "failed":
      return (
        <span className="text-sm text-red-600">
          <Trans>失败</Trans>
        </span>
      );
    default:
      return null;
  }
}

function MarkReadSenderStatus({
  status,
}: {
  status: ReturnType<typeof useMarkReadSenderStatus>;
}) {
  switch (status?.status) {
    case "completed":
      return (
        <span className="text-sm text-green-600">
          {status.threadsTotal ? (
            <Plural
              value={status.threadsTotal}
              one="已将 # 个标记为已读！"
              other="已将 # 个标记为已读！"
            />
          ) : (
            <Trans>已标记为已读</Trans>
          )}
        </span>
      );
    case "processing":
      return (
        <span className="text-sm text-blue-600">
          {status.threadsTotal - status.threadIds.length} /{" "}
          {status.threadsTotal}
        </span>
      );
    case "pending":
      return (
        <span className="text-sm text-muted-foreground">
          <Trans>等待中...</Trans>
        </span>
      );
    case "failed":
      return (
        <span className="text-sm text-red-600">
          <Trans>失败</Trans>
        </span>
      );
    default:
      return null;
  }
}

function DeleteSenderStatus({
  status,
}: {
  status: ReturnType<typeof useDeleteSenderStatus>;
}) {
  switch (status?.status) {
    case "completed":
      return (
        <span className="text-sm text-green-600">
          {status.threadsTotal ? (
            <Plural
              value={status.threadsTotal}
              one="已删除 # 个！"
              other="已删除 # 个！"
            />
          ) : (
            <Trans>已删除</Trans>
          )}
        </span>
      );
    case "processing":
      return (
        <span className="text-sm text-blue-600">
          {status.threadsTotal - status.threadIds.length} /{" "}
          {status.threadsTotal}
        </span>
      );
    case "pending":
      return (
        <span className="text-sm text-muted-foreground">
          <Trans>等待中...</Trans>
        </span>
      );
    case "failed":
      return (
        <span className="text-sm text-red-600">
          <Trans>失败</Trans>
        </span>
      );
    default:
      return null;
  }
}

function CompletedSenderCount({
  count,
  bulkAction,
}: {
  count: number;
  bulkAction: BulkActionType;
}) {
  if (bulkAction === "delete") {
    return (
      <Plural value={count} one="已删除 # 个发件人" other="已删除 # 个发件人" />
    );
  }
  if (bulkAction === "markRead") {
    return (
      <Plural
        value={count}
        one="# 个发件人已标记为已读"
        other="# 个发件人已标记为已读"
      />
    );
  }
  return (
    <Plural value={count} one="已归档 # 个发件人" other="已归档 # 个发件人" />
  );
}

function getBulkActionFailedMessage(action: BulkActionType, i18n: I18n) {
  if (action === "markRead")
    return coreT(i18n)`部分发件人标记为已读失败。请重试。`;
  if (action === "delete") return coreT(i18n)`部分发件人删除失败。请重试。`;
  return coreT(i18n)`部分发件人归档失败。请重试。`;
}

function ExpandedEmails({
  sender,
  userEmail,
}: {
  sender: string;
  userEmail: string;
}) {
  const { provider } = useAccount();

  const { data, isLoading, error } = useThreads({
    fromEmail: sender,
    limit: 5,
    type: "inbox",
  });

  if (isLoading) {
    return (
      <div className="border-t bg-muted/30 p-4">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t bg-muted/30 p-4 text-sm text-muted-foreground">
        <Trans>加载邮件时出错</Trans>
      </div>
    );
  }

  if (!data?.threads.length) {
    return (
      <div className="border-t bg-muted/30 p-4 text-sm text-muted-foreground">
        <Trans>未找到邮件</Trans>
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/30">
      <div className="py-2">
        {data.threads.slice(0, 5).map((thread) => {
          const firstMessage = thread.messages[0];
          if (!firstMessage) return null;
          const subject = firstMessage.subject;
          const date = firstMessage.date;
          const snippet = thread.snippet || firstMessage.snippet;

          return (
            <div key={thread.id} className="flex">
              <div className="flex items-center pl-[26px]">
                <div className="h-full w-px bg-border" />
                <div className="h-px w-4 bg-border" />
              </div>
              <Link
                href={getEmailUrl(thread.id, userEmail, provider)}
                target="_blank"
                rel="noopener noreferrer"
                className="mr-2 flex flex-1 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <MailIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">
                    {subject.length > 50
                      ? `${subject.slice(0, 50)}...`
                      : subject}
                  </span>
                  {snippet && (
                    <span className="ml-2 text-muted-foreground">
                      {(() => {
                        // Remove invisible/zero-width chars and normalize whitespace
                        const cleaned = snippet
                          .replace(/[\u034F\u200B-\u200D\uFEFF\u00A0]/g, "")
                          .trim()
                          .replace(/\s+/g, " ");
                        return cleaned.length > 80
                          ? `${cleaned.slice(0, 80).trimEnd()}...`
                          : cleaned;
                      })()}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatShortDate(new Date(date))}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
