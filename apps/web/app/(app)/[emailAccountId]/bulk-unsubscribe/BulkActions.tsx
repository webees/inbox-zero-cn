import { useCallback, useMemo, useState } from "react";
import { usePostHog } from "posthog-js/react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  MailXIcon,
  MoreHorizontalIcon,
  ThumbsUpIcon,
  TrashIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { DateRange } from "react-day-picker";
import {
  useBulkUnsubscribe,
  useBulkApprove,
  useBulkAutoArchive,
  useBulkArchive,
  useBulkDelete,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/hooks";
import {
  UnsubscribeCelebrationDialog,
  type UnsubscribeCelebration,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/UnsubscribeCelebrationDialog";
import { PremiumTooltip } from "@/components/PremiumAlert";
import { usePremium } from "@/hooks/usePremium";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { useAccount } from "@/providers/EmailAccountProvider";
import { cn } from "@/utils";
import { getHttpUnsubscribeLink } from "@/utils/parse/unsubscribe";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SenderIcon } from "@/components/SenderIcon";
import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
import { NewsletterStatus } from "@/generated/prisma/enums";
import type { NewsletterFilterType } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/types";

type Newsletter = NewsletterStatsResponse["newsletters"][number];

function ActionButton({
  icon: Icon,
  label,
  loadingLabel,
  onClick,
  loading,
  primary,
  showLabelOnMobile,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  loadingLabel?: string;
  onClick: () => void;
  loading?: boolean;
  primary?: boolean;
  showLabelOnMobile?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={label}
      className={cn(
        "flex h-9 items-center gap-2 px-2.5 sm:px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap",
        primary
          ? "bg-blue-600 text-white hover:bg-blue-500"
          : "text-foreground hover:bg-muted",
        loading && "opacity-50 cursor-not-allowed",
      )}
    >
      {loading ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <Icon className="size-4" />
      )}
      <span className={showLabelOnMobile ? undefined : "hidden sm:inline"}>
        {loading && loadingLabel ? loadingLabel : label}
      </span>
    </button>
  );
}

export function BulkActions({
  selected,
  mutate,
  onClearSelection,
  deselectItem,
  newsletters,
  filter,
  dateRange,
}: {
  selected: Map<string, boolean>;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  mutate: () => Promise<any>;
  onClearSelection: () => void;
  deselectItem: (id: string) => void;
  newsletters?: Newsletter[];
  filter: NewsletterFilterType;
  dateRange?: DateRange;
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [autoArchiveDialogOpen, setAutoArchiveDialogOpen] = useState(false);
  const [celebration, setCelebration] = useState<UnsubscribeCelebration | null>(
    null,
  );

  const posthog = usePostHog();
  const { hasUnsubscribeAccess, mutate: refetchPremium } = usePremium();
  const { PremiumModal, openModal } = usePremiumModal();
  const { emailAccountId } = useAccount();
  const onBulkUnsubscribeSuccess = useCallback((items: Newsletter[]) => {
    if (items.length === 0) return;
    setCelebration({
      senderCount: items.length,
      emailCount: items.reduce((sum, item) => sum + item.value, 0),
    });
  }, []);
  const { onBulkUnsubscribe } = useBulkUnsubscribe<Newsletter>({
    hasUnsubscribeAccess,
    mutate,
    posthog,
    refetchPremium,
    emailAccountId,
    onDeselectItem: deselectItem,
    filter,
    onSuccess: onBulkUnsubscribeSuccess,
  });

  const { onBulkApprove } = useBulkApprove({
    mutate,
    posthog,
    emailAccountId,
    onDeselectItem: deselectItem,
    filter,
  });

  const { onBulkAutoArchive } = useBulkAutoArchive({
    hasUnsubscribeAccess,
    mutate,
    refetchPremium,
    emailAccountId,
    onDeselectItem: deselectItem,
    filter,
  });

  const { onBulkArchive, isBulkArchiving } = useBulkArchive({
    posthog,
    emailAccountId,
    mutate,
  });

  const { onBulkDelete, isBulkDeleting } = useBulkDelete({
    mutate,
    posthog,
    emailAccountId,
  });

  const getSelectedValues = () =>
    Array.from(selected.entries())
      .filter(([, value]) => value)
      .map(([name, value]) => ({
        name,
        value,
      }));

  const selectedCount = Array.from(selected.values()).filter(Boolean).length;
  const isVisible = selectedCount > 0;

  // 获取所选发件人的详细信息
  const selectedNewsletters =
    newsletters?.filter((n) => selected.get(n.name)) || [];

  // 检查是否所有所选发件人都已批准
  const allSelectedAreApproved = useMemo(() => {
    if (selectedNewsletters.length === 0) return false;
    return selectedNewsletters.every(
      (n) => n.status === NewsletterStatus.APPROVED,
    );
  }, [selectedNewsletters]);

  // 选择映射中可能保留已不在当前拉取结果里的发件人（例如搜索或日期范围变更后），
  // 因此只有在拿到完整行数据时才提供退订操作。
  const allSelectedCanUnsubscribe =
    selectedNewsletters.length > 0 &&
    selectedNewsletters.every(
      (n) => n.status !== NewsletterStatus.UNSUBSCRIBED,
    );

  const hasUnsubscribeLinks = selectedNewsletters.some((n) =>
    getHttpUnsubscribeLink({ unsubscribeLink: n.unsubscribeLink }),
  );

  const hasBlockableLinks = selectedNewsletters.some(
    (n) => !getHttpUnsubscribeLink({ unsubscribeLink: n.unsubscribeLink }),
  );

  const unsubscribeLabel =
    hasUnsubscribeLinks && hasBlockableLinks
      ? "退订/屏蔽"
      : hasBlockableLinks
        ? "屏蔽"
        : "退订";

  return (
    <>
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="sticky bottom-6 z-40 mx-auto mt-4 w-fit max-w-full"
          >
            <PremiumTooltip
              showTooltip={!hasUnsubscribeAccess}
              openModal={openModal}
            >
              <div className="flex items-center gap-1 overflow-x-auto rounded-xl border bg-background py-2 pr-2 pl-3 shadow-lg">
                <button
                  type="button"
                  onClick={onClearSelection}
                  aria-label="清除选择"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
                <span className="whitespace-nowrap pr-1 text-sm font-medium">
                  {selectedCount}
                  <span className="hidden sm:inline"> 已选择</span>
                </span>

                <div className="mx-1 h-6 w-px shrink-0 bg-border sm:mx-2" />

                {allSelectedCanUnsubscribe && (
                  <ActionButton
                    icon={MailXIcon}
                    label={unsubscribeLabel}
                    primary
                    showLabelOnMobile
                    onClick={() => onBulkUnsubscribe(selectedNewsletters)}
                  />
                )}
                <ActionButton
                  icon={allSelectedAreApproved ? Undo2Icon : ThumbsUpIcon}
                  label={allSelectedAreApproved ? "移至待审核" : "保留"}
                  onClick={() =>
                    onBulkApprove(getSelectedValues(), allSelectedAreApproved)
                  }
                />
                <ActionButton
                  icon={ArchiveIcon}
                  label="归档"
                  loadingLabel="正在归档"
                  onClick={() => setArchiveDialogOpen(true)}
                  loading={isBulkArchiving}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="更多操作"
                      disabled={isBulkDeleting}
                    >
                      {isBulkDeleting ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <MoreHorizontalIcon className="size-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    <DropdownMenuItem
                      onClick={() => setAutoArchiveDialogOpen(true)}
                    >
                      <ArchiveRestoreIcon className="mr-2 size-4" />
                      自动归档以后的邮件
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <TrashIcon className="mr-2 size-4" />
                      删除所有邮件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </PremiumTooltip>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除所有邮件？</DialogTitle>
            <DialogDescription>
              确定要删除这些发件人的所有邮件吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>

          {/* 所选发件人列表 */}
          {selectedNewsletters.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {selectedNewsletters.map((newsletter) => (
                  <div
                    key={newsletter.name}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <SenderIcon
                      email={newsletter.name}
                      name={newsletter.fromName}
                      size={32}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-sm truncate">
                        {newsletter.fromName || newsletter.name}
                      </span>
                      {newsletter.fromName && (
                        <span className="text-xs text-muted-foreground truncate">
                          {newsletter.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onBulkDelete(getSelectedValues());
                setDeleteDialogOpen(false);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 归档确认对话框 */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归档所有邮件？</DialogTitle>
            <DialogDescription>
              确定要归档这些发件人的所有邮件吗？
            </DialogDescription>
          </DialogHeader>

          {/* Selected Senders List */}
          {selectedNewsletters.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {selectedNewsletters.map((newsletter) => (
                  <div
                    key={newsletter.name}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <SenderIcon
                      email={newsletter.name}
                      name={newsletter.fromName}
                      size={32}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-sm truncate">
                        {newsletter.fromName || newsletter.name}
                      </span>
                      {newsletter.fromName && (
                        <span className="text-xs text-muted-foreground truncate">
                          {newsletter.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                onBulkArchive(getSelectedValues());
                setArchiveDialogOpen(false);
              }}
            >
              归档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 自动归档确认对话框 */}
      <Dialog
        open={autoArchiveDialogOpen}
        onOpenChange={setAutoArchiveDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自动归档这些发件人？</DialogTitle>
            <DialogDescription>
              自动归档这些发件人当前和以后的所有邮件。它们将不再出现在你的收件箱中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAutoArchiveDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                onBulkAutoArchive(getSelectedValues());
                setAutoArchiveDialogOpen(false);
              }}
            >
              自动归档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsubscribeCelebrationDialog
        celebration={celebration}
        dateRange={dateRange}
        onClose={() => setCelebration(null)}
      />

      <PremiumModal />
    </>
  );
}
