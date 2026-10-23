"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GripVerticalIcon,
  ChevronLeftIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { MailSplitFilterKind, type SystemType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_SPLIT_FILTERS,
  type MailSplitFilterDraft,
} from "@/utils/split-inbox/split-filters";
import { OLDER_THAN_OPTIONS } from "@/utils/split-inbox/split-query";
import {
  availableLibraryFilters,
  findLibrarySplit as findMatchingLibrarySplit,
  libraryDefinition,
  SPLIT_LIBRARY,
  SPLIT_LIBRARY_CATEGORIES,
  type SplitLibraryEntry,
} from "@/utils/split-inbox/split-library";
import { cn } from "@/utils";

const YOUR_SPLITS = "你的分栏";

const FIELDS = [
  { kind: MailSplitFilterKind.LABEL, name: "含有标签" },
  { kind: MailSplitFilterKind.FROM, name: "发件人" },
  { kind: MailSplitFilterKind.CATEGORY, name: "属于分类" },
  { kind: MailSplitFilterKind.UNREAD, name: "未读" },
  { kind: MailSplitFilterKind.STARRED, name: "已加星标" },
  { kind: MailSplitFilterKind.OLDER_THAN, name: "早于" },
] as const;

export type SplitChoice = { id: string; name: string; value: string };

export type ExistingSplit = {
  id: string;
  name: string;
  matchAll: boolean;
  filters: { kind: MailSplitFilterKind; value: string | null }[];
};

export type NewSplitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: SplitChoice[];
  categories: SplitChoice[];
  /** 已位于标签栏上的分栏，这样库可以显示哪些已启用。 */
  existingSplits: ExistingSplit[];
  /** 当对话框是为了修改分栏而非新增时设置。 */
  editing: ExistingSplit | null;
  supportsStarred: boolean;
  onCreate: (split: {
    name: string;
    matchAll: boolean;
    filters: MailSplitFilterDraft[];
  }) => Promise<boolean>;
  onUpdate: (split: {
    id: string;
    name: string;
    matchAll: boolean;
    filters: MailSplitFilterDraft[];
  }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onReorder: (ids: string[]) => Promise<boolean>;
  onEdit: (id: string) => void;
  onDescribe: (prompt: string) => Promise<{
    filters: MailSplitFilterDraft[];
    name: string | null;
    matchAll: boolean;
  } | null>;
  onToggleSystemType?: (
    systemType: SystemType,
    enabled: boolean,
  ) => Promise<boolean>;
};

const EXAMPLES = [
  "来自我会计的未读邮件",
  "来自 Stripe 的收据",
  "我还没读的通知",
  "任何等待我回复的邮件",
];

export function NewSplitDialog({
  open,
  onOpenChange,
  labels,
  categories,
  existingSplits,
  editing,
  supportsStarred,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onEdit,
  onDescribe,
  onToggleSystemType,
}: NewSplitDialogProps) {
  const [mode, setMode] = useState<"library" | "build" | "describe">("library");
  const [category, setCategory] = useState(YOUR_SPLITS);
  const [detail, setDetail] = useState<SplitLibraryEntry | null>(null);
  const [conditions, setConditions] = useState<MailSplitFilterDraft[]>([]);
  const [matchAll, setMatchAll] = useState(true);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const moveSplit = async (id: string, targetId: string) => {
    if (isBusy || id === targetId || id === "all" || targetId === "all") return;
    const ids = existingSplits
      .filter((split) => split.id !== "all")
      .map((split) => split.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    setIsBusy(true);
    try {
      await onReorder(ids);
    } finally {
      setIsBusy(false);
    }
  };

  const removeSplit = async (id: string) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await onDelete(id);
    } finally {
      setIsBusy(false);
    }
  };

  const fields = useMemo(
    () =>
      FIELDS.filter(
        (field) =>
          supportsStarred || field.kind !== MailSplitFilterKind.STARRED,
      ),
    [supportsStarred],
  );

  const valueOptionsFor = useCallback(
    (kind: MailSplitFilterKind): SplitChoice[] => {
      if (kind === MailSplitFilterKind.LABEL) return labels;
      if (kind === MailSplitFilterKind.CATEGORY) return categories;
      if (kind === MailSplitFilterKind.OLDER_THAN) {
        return OLDER_THAN_OPTIONS.map((option) => ({
          id: option.value,
          name: option.name,
          value: option.value,
        }));
      }
      return [];
    },
    [categories, labels],
  );

  const defaultCondition = useCallback(
    (kind: MailSplitFilterKind): MailSplitFilterDraft => ({
      kind,
      value: valueOptionsFor(kind)[0]?.value ?? null,
    }),
    [valueOptionsFor],
  );

  /**
   * 新行会从一个该账号确实能填写的字段开始——在没有标签的账号上预先
   * 设为“含有标签”，会让构建器打开一个无法保存的条件。
   */
  const newCondition = useCallback((): MailSplitFilterDraft => {
    if (labels.length) return defaultCondition(MailSplitFilterKind.LABEL);
    if (categories.length)
      return defaultCondition(MailSplitFilterKind.CATEGORY);
    return defaultCondition(MailSplitFilterKind.UNREAD);
  }, [categories.length, defaultCondition, labels.length]);

  // 为编辑而打开时会直接进入构建器并载入该分栏。
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setMode("build");
      setConditions(
        editing.filters.map(({ kind, value }) => ({ kind, value })),
      );
      setMatchAll(editing.matchAll);
      setName(editing.name);
    } else {
      setMode("library");
      setCategory(YOUR_SPLITS);
      setConditions([]);
      setMatchAll(true);
      setName("");
    }
    setDetail(null);
    setPrompt("");
  }, [editing, open]);

  const describedName = useMemo(
    () =>
      conditions
        .map((c) => conditionLabel(c, labels, categories))
        .join(matchAll ? " · " : " 或 "),
    [categories, conditions, labels, matchAll],
  );

  const libraryEntries = useMemo(() => {
    const labelsByName = new Map(
      labels.map((label) => [label.name.toLowerCase(), label.value]),
    );
    const categoriesByName = new Map(
      categories.map((choice) => [choice.name.toLowerCase(), choice.value]),
    );

    return SPLIT_LIBRARY.filter(
      (entry) =>
        entry.category === category &&
        (supportsStarred ||
          !entry.conditions.some((condition) => condition.kind === "STARRED")),
    ).flatMap((entry) => {
      const filters = availableLibraryFilters(entry, {
        labelsByName,
        categoriesByName,
      });
      return filters !== null ? [{ entry, filters }] : [];
    });
  }, [categories, category, labels, supportsStarred]);

  const findLibrarySplit = useCallback(
    (entry: SplitLibraryEntry, filters: MailSplitFilterDraft[]) =>
      findMatchingLibrarySplit(entry, filters, existingSplits),
    [existingSplits],
  );

  const close = () => onOpenChange(false);

  const save = async () => {
    if (!conditions.length || isBusy) return;
    setIsBusy(true);
    try {
      const payload = {
        name: name.trim() || describedName,
        matchAll,
        filters: conditions,
      };
      const saved = editing
        ? await onUpdate({ id: editing.id, ...payload })
        : await onCreate(payload);
      if (saved) close();
    } finally {
      setIsBusy(false);
    }
  };

  const toggleLibraryEntry = async (
    entry: SplitLibraryEntry,
    filters: MailSplitFilterDraft[],
  ) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const existing = findLibrarySplit(entry, filters);
      if (entry.createsSystemType) {
        if (!onToggleSystemType) return;
        await onToggleSystemType(entry.createsSystemType, !existing);
        return;
      }
      if (existing) await onDelete(existing.id);
      else
        await onCreate({
          name: entry.name,
          matchAll: entry.matchAll ?? true,
          filters,
        });
    } finally {
      setIsBusy(false);
    }
  };

  const describe = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isBusy) return;
    setIsBusy(true);
    try {
      const result = await onDescribe(trimmed);
      if (!result) return;
      // 条件会进入构建器而不创建分栏，因此猜错只会多花一次点击，
      // 而不是让读者去撤销一个标签。
      setConditions(result.filters);
      setMatchAll(result.matchAll);
      if (result.name) setName(result.name);
      setMode("build");
    } finally {
      setIsBusy(false);
    }
  };

  const title =
    mode === "build"
      ? editing
        ? "编辑分栏"
        : "构建分栏"
      : mode === "describe"
        ? "描述此分栏"
        : "新建分栏收件箱";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "top-[9vh] flex max-h-[80vh] w-[620px] max-w-[94vw] translate-y-0 flex-col gap-0 overflow-hidden p-0",
          // 对话框基础组件设置了 `md:w-full` 与 `sm:rounded-lg`；在
          // tailwind-merge 中，这些响应式变体的优先级高于无前缀的覆盖。
          "rounded-2xl sm:rounded-2xl md:w-[620px]",
        )}
        hideCloseButton
      >
        <div className="flex shrink-0 items-center gap-2.5 border-border border-b px-4 py-3">
          {(mode !== "library" || detail) && (
            <Button
              type="button"
              aria-label="返回"
              onClick={() => {
                if (detail) setDetail(null);
                else {
                  setMode("library");
                  if (!editing) setConditions([]);
                }
              }}
              variant="secondary"
              size="icon2xs"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          )}
          <DialogTitle className="min-w-0 flex-1 truncate font-medium text-[15px] tracking-tight">
            {detail ? detail.name : title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            为你的收件箱添加一个带筛选的标签页。
          </DialogDescription>
          <Button
            type="button"
            aria-label="关闭"
            onClick={close}
            variant="ghostMuted"
            size="icon2xs"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>

        {detail ? (
          <LibraryDetail entry={detail} />
        ) : mode === "library" ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex w-[142px] shrink-0 flex-col gap-0.5 overflow-y-auto border-border border-r bg-sidebar p-2 scrollbar-thin">
              <div className="px-2 pt-0.5 pb-1.5 font-medium text-[11px] text-muted-foreground">
                分类
              </div>
              {[YOUR_SPLITS, ...SPLIT_LIBRARY_CATEGORIES].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  aria-current={option === category ? "true" : undefined}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    option === category
                      ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(17,24,39,0.05)]"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto p-3.5 scrollbar-thin">
              <div className="mb-3.5 grid grid-cols-2 gap-2.5">
                <RouteCard
                  icon={<PlusIcon className="size-3.5" />}
                  label="自行构建"
                  onClick={() => {
                    setConditions(
                      conditions.length ? conditions : [newCondition()],
                    );
                    setMode("build");
                  }}
                />
                <RouteCard
                  icon={<SparklesIcon className="size-3.5" />}
                  label="描述它"
                  onClick={() => setMode("describe")}
                />
              </div>

              <div className="mb-2 font-medium text-[11px] text-muted-foreground">
                {category}
              </div>

              {category === YOUR_SPLITS ? (
                existingSplits.length ? (
                  <ul
                    className="space-y-1"
                    aria-label="分栏顺序"
                    aria-busy={isBusy}
                  >
                    {existingSplits.map((split, index) => (
                      <li
                        key={split.id}
                        className={cn(
                          "flex min-w-0 items-center gap-1 rounded-lg px-1 py-1.5",
                          dropTargetId === split.id
                            ? "bg-accent ring-1 ring-border"
                            : "hover:bg-muted/50",
                          draggedId === split.id && "opacity-50",
                        )}
                        onDragOver={(event) => {
                          if (!draggedId || isBusy || split.id === "all")
                            return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDropTargetId(split.id);
                        }}
                        onDragLeave={() => setDropTargetId(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedId) moveSplit(draggedId, split.id);
                          setDraggedId(null);
                          setDropTargetId(null);
                        }}
                      >
                        <span
                          draggable={!isBusy && split.id !== "all"}
                          data-drag-split={split.id}
                          aria-hidden="true"
                          className={cn(
                            "p-1 text-muted-foreground",
                            split.id === "all"
                              ? "invisible"
                              : "cursor-grab active:cursor-grabbing",
                          )}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", split.id);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggedId(split.id);
                          }}
                          onDragEnd={() => {
                            setDraggedId(null);
                            setDropTargetId(null);
                          }}
                        >
                          <GripVerticalIcon className="size-3.5" />
                        </span>
                        <button
                          type="button"
                          disabled={isBusy || !split.filters.length}
                          aria-label={`编辑 ${split.name} 分栏`}
                          onClick={() => onEdit(split.id)}
                          className="min-w-0 flex-1 truncate rounded text-left font-medium text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {split.name}
                        </button>
                        <Button
                          variant="ghostMuted"
                          size="iconXs"
                          aria-label={`将 ${split.name} 上移`}
                          disabled={
                            isBusy ||
                            split.id === "all" ||
                            index === 0 ||
                            existingSplits[index - 1].id === "all"
                          }
                          onClick={() =>
                            moveSplit(split.id, existingSplits[index - 1].id)
                          }
                        >
                          <ArrowUpIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghostMuted"
                          size="iconXs"
                          aria-label={`将 ${split.name} 下移`}
                          disabled={
                            isBusy ||
                            split.id === "all" ||
                            index === existingSplits.length - 1
                          }
                          onClick={() =>
                            moveSplit(split.id, existingSplits[index + 1].id)
                          }
                        >
                          <ArrowDownIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghostMuted"
                          size="iconXs"
                          disabled={isBusy || !split.filters.length}
                          aria-label={`关闭 ${split.name} 分栏`}
                          onClick={() => removeSplit(split.id)}
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    你自己构建的分栏会显示在这里。
                  </p>
                )
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {libraryEntries.map(({ entry, filters }) => (
                    <LibraryTile
                      key={entry.name}
                      entry={entry}
                      on={!!findLibrarySplit(entry, filters)}
                      disabled={isBusy}
                      onInfo={() => setDetail(entry)}
                      onToggle={() => toggleLibraryEntry(entry, filters)}
                    />
                  ))}
                  {!libraryEntries.length && (
                    <p className="col-span-2 text-muted-foreground text-xs leading-relaxed">
                      这里还没有内容——这些分栏需要此账号没有的标签。
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : mode === "build" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3.5 scrollbar-thin">
            <div className="mb-3 flex items-center gap-2 text-muted-foreground text-xs">
              <span>显示匹配以下条件的邮件</span>
              <select
                aria-label="匹配全部或任一条件"
                value={matchAll ? "all" : "any"}
                onChange={(event) => setMatchAll(event.target.value === "all")}
                className="h-7 rounded-lg border border-border bg-background py-0 pr-8 pl-1.5 text-foreground text-xs outline-none transition-[color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50"
              >
                <option value="all">全部</option>
                <option value="any">任一</option>
              </select>
              <span>这些条件</span>
            </div>

            <div className="flex flex-col gap-2">
              {conditions.map((condition, index) => (
                <ConditionRow
                  // 各行按位置区分：两个“含有标签”行仅凭位置不同而不同，
                  // 因此索引就是身份标识。
                  key={index}
                  condition={condition}
                  fields={fields}
                  valueOptions={valueOptionsFor(condition.kind)}
                  onChangeField={(kind) =>
                    setConditions((current) =>
                      current.map((item, i) =>
                        i === index ? defaultCondition(kind) : item,
                      ),
                    )
                  }
                  onChangeValue={(value) =>
                    setConditions((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, value } : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    setConditions((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                />
              ))}
            </div>

            <button
              type="button"
              disabled={conditions.length >= MAX_SPLIT_FILTERS}
              onClick={() =>
                setConditions((current) =>
                  current.length < MAX_SPLIT_FILTERS
                    ? [...current, newCondition()]
                    : current,
                )
              }
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-primary text-xs hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PlusIcon className="size-3.5" />
              添加条件
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col p-3.5">
            <Textarea
              autoFocus
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述什么样的邮件应归入此分栏…"
              maxLength={300}
              className="resize-none rounded-xl text-[13.5px]"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/25 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {(detail || mode === "build" || mode === "describe") && (
          <div className="flex shrink-0 items-center gap-2.5 border-border border-t bg-sidebar px-4 py-2.5">
            {detail ? (
              <>
                <div className="flex-1" />
                <Button
                  variant="gradient"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    const filters = libraryFiltersFor(
                      detail,
                      labels,
                      categories,
                    );
                    if (filters) toggleLibraryEntry(detail, filters);
                    setDetail(null);
                  }}
                >
                  {findLibrarySplit(
                    detail,
                    libraryFiltersFor(detail, labels, categories) ?? [],
                  )
                    ? "关闭分栏"
                    : "开启分栏"}
                </Button>
              </>
            ) : mode === "build" ? (
              <>
                <span className="shrink-0 text-muted-foreground text-xs">
                  分栏名称
                </span>
                <Input
                  aria-label="分栏名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    save();
                  }}
                  placeholder={describedName || "为此分栏命名"}
                  maxLength={60}
                  className="h-8 w-[190px] shrink-0 text-xs"
                />
                <div className="flex-1" />
                <Button
                  variant="gradient"
                  size="sm"
                  disabled={!conditions.length || isBusy}
                  onClick={save}
                >
                  {editing ? "保存更改" : "添加分栏"}
                </Button>
              </>
            ) : mode === "describe" ? (
              <>
                <div className="flex-1" />
                <Button
                  variant="gradient"
                  size="sm"
                  disabled={!prompt.trim() || isBusy}
                  onClick={describe}
                >
                  {isBusy ? (
                    <>
                      <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                      构建中…
                    </>
                  ) : (
                    "构建"
                  )}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RouteCard({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-sm hover:border-primary/25 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-4.5 shrink-0 items-center justify-center text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-[12.5px] text-primary">
        {label}
      </span>
    </button>
  );
}

function LibraryTile({
  entry,
  on,
  disabled,
  onInfo,
  onToggle,
}: {
  entry: SplitLibraryEntry;
  on: boolean;
  disabled: boolean;
  onInfo: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5",
        on
          ? "border-primary/25 bg-primary/5 text-primary"
          : "border-border bg-card text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="min-w-0 flex-1 truncate text-left font-medium text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {entry.name}
      </button>
      <button
        type="button"
        aria-label={`${entry.name} 分栏的作用`}
        onClick={onInfo}
        className="hidden size-4.5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within:flex group-hover:flex"
      >
        <InfoGlyph />
      </button>
      <button
        type="button"
        aria-label={on ? `关闭 ${entry.name} 分栏` : `开启 ${entry.name} 分栏`}
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {on ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <PlusIcon className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function LibraryDetail({ entry }: { entry: SplitLibraryEntry }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="p-4">
        <div className="mb-2 font-medium text-[11px] text-muted-foreground">
          定义
        </div>
        <div className="flex flex-col gap-1.5">
          {libraryDefinition(entry).map((row) => (
            <div
              key={`${row.key}:${row.value}`}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-2"
            >
              <span className="w-12 shrink-0 text-[11.5px] text-muted-foreground">
                {row.key}
              </span>
              <span className="truncate font-mono text-[12px] text-foreground">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  fields,
  valueOptions,
  onChangeField,
  onChangeValue,
  onRemove,
}: {
  condition: MailSplitFilterDraft;
  fields: readonly { kind: MailSplitFilterKind; name: string }[];
  valueOptions: SplitChoice[];
  onChangeField: (kind: MailSplitFilterKind) => void;
  onChangeValue: (value: string) => void;
  onRemove: () => void;
}) {
  const takesFreeText = condition.kind === MailSplitFilterKind.FROM;
  const takesNoValue =
    condition.kind === MailSplitFilterKind.UNREAD ||
    condition.kind === MailSplitFilterKind.STARRED;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="条件字段"
        value={condition.kind}
        onChange={(event) =>
          onChangeField(event.target.value as MailSplitFilterKind)
        }
        className="h-8 w-[132px] shrink-0 rounded-lg border border-border bg-background px-2 text-foreground text-xs outline-none transition-[color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50"
      >
        {fields.map((field) => (
          <option key={field.kind} value={field.kind}>
            {field.name}
          </option>
        ))}
      </select>

      {takesNoValue ? (
        <div className="min-w-0 flex-1" />
      ) : takesFreeText ? (
        <Input
          value={condition.value ?? ""}
          onChange={(event) => onChangeValue(event.target.value)}
          placeholder="name@company.com 或 @company.com"
          aria-label="发件人"
          className="h-8 min-w-0 flex-1 text-xs"
        />
      ) : (
        <select
          aria-label="条件值"
          value={condition.value ?? ""}
          onChange={(event) => onChangeValue(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-foreground text-xs outline-none transition-[color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50"
        >
          {valueOptions.map((option) => (
            <option key={option.id} value={option.value}>
              {option.name}
            </option>
          ))}
        </select>
      )}

      <Button
        type="button"
        aria-label="移除条件"
        onClick={onRemove}
        variant="destructiveGhost"
        size="iconXs"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function InfoGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="size-3.5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function libraryFiltersFor(
  entry: SplitLibraryEntry,
  labels: SplitChoice[],
  categories: SplitChoice[],
) {
  return availableLibraryFilters(entry, {
    labelsByName: new Map(
      labels.map((label) => [label.name.toLowerCase(), label.value]),
    ),
    categoriesByName: new Map(
      categories.map((choice) => [choice.name.toLowerCase(), choice.value]),
    ),
  });
}

function conditionLabel(
  condition: MailSplitFilterDraft,
  labels: SplitChoice[],
  categories: SplitChoice[],
): string {
  switch (condition.kind) {
    case MailSplitFilterKind.UNREAD:
      return "未读";
    case MailSplitFilterKind.STARRED:
      return "已加星标";
    case MailSplitFilterKind.FROM:
      return condition.value ?? "发件人";
    case MailSplitFilterKind.OLDER_THAN:
      return `早于 ${
        OLDER_THAN_OPTIONS.find((o) => o.value === condition.value)?.name ??
        condition.value
      }`;
    case MailSplitFilterKind.LABEL:
      return (
        labels.find((label) => label.value === condition.value)?.name ?? "标签"
      );
    case MailSplitFilterKind.CATEGORY:
      return (
        categories.find((category) => category.value === condition.value)
          ?.name ?? "分类"
      );
  }
}
