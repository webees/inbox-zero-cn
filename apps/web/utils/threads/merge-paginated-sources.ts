import { mapWithConcurrency } from "@/utils/async";

/**
 * 将多个独立分页的服务商合并为一个有序列表。
 *
 * 每个来源保留自己的分页令牌，因此缓慢或已耗尽的来源永远不会阻塞其他来源。
 * 未返回的行可以在请求之间缓冲；已消费的 ID 也能让过期的缓冲区从服务商页面继续。
 */
export async function mergePaginatedSources<
  TSource extends { id: string },
  TItem,
  TMeta,
>({
  sources,
  cursor,
  limit,
  concurrency,
  compare,
  getItemId,
  dedupeItemKey,
  loadPage,
  onSourceError,
  pageBuffer,
}: {
  sources: TSource[];
  cursor: string | null;
  limit: number;
  concurrency: number;
  /** 对合并后的行排序；返回前 `limit` 行。 */
  compare: (left: TItem, right: TItem) => number;
  /** 标识某行在其自身来源中的身份，用于跟踪已消费的行。 */
  getItemId: (item: TItem) => string;
  /**
   * 跨来源标识同一行，适用于可能返回同一行的来源。
   * 共享同一键的行只返回一次并被记住，以免后续页面重复返回。
   * 当来源之间从不重叠时，保持未设置。
   */
  dedupeItemKey?: (item: TItem) => string;
  loadPage: (input: {
    source: TSource;
    pageToken?: string;
  }) => Promise<PaginatedPage<TItem, TMeta>>;
  pageBuffer?: PageBuffer<TItem, TMeta>;
  onSourceError: (input: { source: TSource; error: unknown }) => void;
}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit 必须是正整数");
  }

  const previousCursor = decodeCursor(cursor);
  const sourcesToLoad = sources.filter(
    (source) => !previousCursor.sources[source.id]?.done,
  );

  const sourcePages = await mapWithConcurrency(
    sourcesToLoad,
    concurrency,
    async (source) => {
      const cursorState =
        previousCursor.sources[source.id] ?? INITIAL_SOURCE_CURSOR;
      try {
        const bufferedPage = cursorState.bufferId
          ? await pageBuffer?.read({
              sourceId: source.id,
              id: cursorState.bufferId,
            })
          : undefined;
        const page =
          bufferedPage ??
          (await loadPage({
            source,
            pageToken: cursorState.pageToken ?? undefined,
          }));
        return {
          source,
          cursorState,
          page,
          bufferId: bufferedPage ? cursorState.bufferId : undefined,
        };
      } catch (error) {
        onSourceError({ source, error });
        return { source, cursorState, page: null };
      }
    },
  );

  const failedSourceIds: string[] = [];
  const metaBySourceId: Record<string, TMeta> = {};
  // 每个来源保留该行自身的 ID，因为两个来源可能以不同方式标识同一行，
  // 且每个来源都需要将各自的 ID 标记为已消费。
  const candidatesByKey = new Map<
    string,
    { item: TItem; itemIdBySource: Map<string, string> }
  >();
  // 键会保留到所有来源都越过该行，因此共享同一行的两个来源无论分页相隔多远，
  // 该行都只会被返回一次。
  const pendingByEmittedKey = new Map(
    previousCursor.emitted.map((entry) => [entry.key, new Set(entry.pending)]),
  );
  const skippedItemIdsBySource = new Map<string, string[]>();
  const keyFor = (item: TItem, source: TSource) =>
    dedupeItemKey?.(item) ?? `${source.id}:${getItemId(item)}`;

  for (const { source, cursorState, page } of sourcePages) {
    if (!page) {
      failedSourceIds.push(source.id);
      continue;
    }
    if (page.meta !== undefined) metaBySourceId[source.id] = page.meta;

    const consumedIds = new Set(cursorState.consumedIds);
    for (const item of page.items) {
      if (consumedIds.has(getItemId(item))) continue;
      const key = keyFor(item, source);
      const stillPending = pendingByEmittedKey.get(key);
      if (stillPending) {
        // 该来源现在已追上已经返回过的行，因此在此处将其消费，
        // 而不是让该页永远看起来未完成。
        stillPending.delete(source.id);
        const skipped = skippedItemIdsBySource.get(source.id) ?? [];
        skipped.push(getItemId(item));
        skippedItemIdsBySource.set(source.id, skipped);
        continue;
      }
      const candidate = candidatesByKey.get(key);
      if (candidate) {
        candidate.itemIdBySource.set(source.id, getItemId(item));
        continue;
      }
      candidatesByKey.set(key, {
        item,
        itemIdBySource: new Map([[source.id, getItemId(item)]]),
      });
    }
  }

  const candidates = [...candidatesByKey.values()].sort((left, right) =>
    compare(left.item, right.item),
  );
  const returned = candidates.slice(0, limit);
  const returnedItemIdsBySource = new Map(skippedItemIdsBySource);
  for (const { itemIdBySource } of returned) {
    for (const [sourceId, itemId] of itemIdBySource) {
      const itemIds = returnedItemIdsBySource.get(sourceId) ?? [];
      itemIds.push(itemId);
      returnedItemIdsBySource.set(sourceId, itemIds);
    }
  }

  const pagesBySourceId = new Map(
    sourcePages.map((sourcePage) => [sourcePage.source.id, sourcePage]),
  );
  const nextCursor = emptyCursor();

  const nextSourceStates = await Promise.all(
    sources.map(async (source): Promise<SourceCursorState> => {
      const sourcePage = pagesBySourceId.get(source.id);
      if (!sourcePage) {
        return previousCursor.sources[source.id] ?? INITIAL_SOURCE_CURSOR;
      }
      if (!sourcePage.page) return sourcePage.cursorState;

      const consumedIds = new Set([
        ...sourcePage.cursorState.consumedIds,
        ...(returnedItemIdsBySource.get(source.id) ?? []),
      ]);
      const remainingItems = sourcePage.page.items.filter(
        (item) => !consumedIds.has(getItemId(item)),
      );
      if (remainingItems.length) {
        const bufferId =
          sourcePage.bufferId ??
          (await pageBuffer?.write({
            sourceId: source.id,
            page: { ...sourcePage.page, items: remainingItems },
          }));
        return {
          ...sourcePage.cursorState,
          consumedIds: [...consumedIds],
          bufferId,
        };
      }
      if (sourcePage.page.nextPageToken) {
        return {
          pageToken: sourcePage.page.nextPageToken,
          consumedIds: [],
          done: false,
        };
      }
      return DONE_SOURCE_CURSOR;
    }),
  );
  nextCursor.sources = Object.fromEntries(
    sources.map((source, index) => [source.id, nextSourceStates[index]]),
  );

  if (dedupeItemKey) {
    for (const { item, itemIdBySource } of returned) {
      const key = dedupeItemKey(item);
      if (pendingByEmittedKey.has(key)) continue;
      pendingByEmittedKey.set(
        key,
        new Set(
          sources
            .map((source) => source.id)
            .filter((sourceId) => !itemIdBySource.has(sourceId)),
        ),
      );
    }
    // 已完成的来源永远不会再返回该行，因此它不再持有该键，
    // 记录也会随之清空，而不是持续增长。
    nextCursor.emitted = [...pendingByEmittedKey]
      .map(([key, pending]) => ({
        key,
        pending: [...pending].filter(
          (sourceId) => nextCursor.sources[sourceId]?.done === false,
        ),
      }))
      .filter((entry) => entry.pending.length > 0);
  }

  return {
    items: returned.map(({ item }) => item),
    metaBySourceId,
    failedSourceIds,
    nextPageToken: Object.values(nextCursor.sources).some(
      (state) => !state.done,
    )
      ? encodeCursor(nextCursor)
      : null,
  };
}

export type PaginatedPage<TItem, TMeta> = {
  items: TItem[];
  nextPageToken?: string | null;
  meta?: TMeta;
};

export type PageBuffer<TItem, TMeta> = {
  read: (input: {
    sourceId: string;
    id: string;
  }) => Promise<PaginatedPage<TItem, TMeta> | undefined>;
  write: (input: {
    sourceId: string;
    page: PaginatedPage<TItem, TMeta>;
  }) => Promise<string | undefined>;
};

type SourceCursorState = {
  bufferId?: string;
  pageToken: string | null;
  consumedIds: string[];
  done: boolean;
};

type MergedCursor = {
  version: 3;
  sources: Record<string, SourceCursorState>;
  /**
   * 已返回的行，以及尚未到达这些行的来源，因此两个来源共享的行
   * 只会返回一次，随后即被遗忘。
   */
  emitted: EmittedKey[];
};

type EmittedKey = { key: string; pending: string[] };

const INITIAL_SOURCE_CURSOR: SourceCursorState = {
  pageToken: null,
  consumedIds: [],
  done: false,
};
const DONE_SOURCE_CURSOR: SourceCursorState = {
  pageToken: null,
  consumedIds: [],
  done: true,
};

function encodeCursor(cursor: MergedCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string | null): MergedCursor {
  if (!cursor) return emptyCursor();

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) return emptyCursor();
    // 此功能上线前加载的页面仍持有 v2 游标。读取它可让“加载更多”
    // 继续向前，而不是从第一页重新开始。
    const rawSources = parsed.version === 3 ? parsed.sources : parsed.accounts;
    if (!isRecord(rawSources)) return emptyCursor();

    const sources = Object.fromEntries(
      Object.entries(rawSources).flatMap((entry) => {
        const state = toSourceCursorState(entry[1]);
        return state ? [[entry[0], state] as const] : [];
      }),
    );
    return {
      version: 3,
      sources,
      emitted: Array.isArray(parsed.emitted)
        ? parsed.emitted.flatMap((entry) =>
            isEmittedKey(entry) ? [entry] : [],
          )
        : [],
    };
  } catch {
    return emptyCursor();
  }
}

function emptyCursor(): MergedCursor {
  return { version: 3, sources: {}, emitted: [] };
}

function toSourceCursorState(value: unknown): SourceCursorState | null {
  if (!isRecord(value)) return null;
  if (typeof value.pageToken !== "string" && value.pageToken !== null) {
    return null;
  }
  if (typeof value.done !== "boolean") return null;
  // v2 将该字段命名为 consumedThreadIds。
  const consumed = value.consumedIds ?? value.consumedThreadIds;
  if (!Array.isArray(consumed)) return null;

  return {
    pageToken: value.pageToken,
    consumedIds: consumed.filter((id): id is string => typeof id === "string"),
    done: value.done,
    bufferId: typeof value.bufferId === "string" ? value.bufferId : undefined,
  };
}

function isEmittedKey(value: unknown): value is EmittedKey {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    Array.isArray(value.pending) &&
    value.pending.every((sourceId) => typeof sourceId === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
