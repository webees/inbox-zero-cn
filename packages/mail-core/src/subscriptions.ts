import {
  canonicalizeCountsQuery,
  canonicalizeQuery,
  type ConversationQuery,
  type MailboxCountsQuery,
  type QueryHandle,
  type QuerySnapshot,
} from "./queries";
import { revisionEquals, type LocalRevision } from "./identities";

export function createQueryRegistry() {
  const groups = new Map<string, QueryGroup<unknown>>();

  return {
    observe<T>(
      key: string,
      load: () => Promise<{ revision: LocalRevision; data: T }>,
    ): QueryHandle<T> {
      let group = groups.get(key) as QueryGroup<T> | undefined;
      if (!group) {
        group = createGroup(load, () => {
          if (group && group.handles.size === 0) groups.delete(key);
        });
        groups.set(key, group as QueryGroup<unknown>);
      }
      return group.observe();
    },
    async refreshKey(key: string) {
      await groups.get(key)?.refresh();
    },
    async refreshPrefix(prefix: string) {
      await Promise.all(
        [...groups.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, group]) => group.refresh()),
      );
    },
    async refreshAll() {
      await Promise.all([...groups.values()].map((group) => group.refresh()));
    },
    closeAll() {
      for (const group of groups.values()) group.close();
      groups.clear();
    },
  };
}

export function mailboxQueryKey(query: ConversationQuery): string {
  return `mailbox:${canonicalizeQuery(query)}`;
}

export function mailboxCountsQueryKey(query: MailboxCountsQuery): string {
  return `counts:${canonicalizeCountsQuery(query)}`;
}

type QueryGroup<T> = {
  handles: Set<MutableHandle<T>>;
  observe(): QueryHandle<T>;
  refresh(): Promise<void>;
  close(): void;
};

type MutableHandle<T> = {
  getSnapshot(): QuerySnapshot<T>;
  publish(snapshot: QuerySnapshot<T>): void;
  subscribe(listener: () => void): () => void;
  close(): void;
};

function createGroup<T>(
  load: () => Promise<{ revision: LocalRevision; data: T }>,
  onEmpty: () => void,
): QueryGroup<T> {
  const handles = new Set<MutableHandle<T>>();
  let latestRead = 0;
  let inFlight: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;
  let publishedData: string | null = null;
  // 较晚加入的对已加载查询的观察者会从最近一次就绪快照开始，
  // 而不是等待自己完成读取。
  let settled: QuerySnapshot<T> | null = null;

  async function runLoad() {
    const read = ++latestRead;
    try {
      const loaded = await load();
      if (read !== latestRead) return;
      // 修订号是数据库级别的，因此大多数刷新都跟随不相关的写入；
      // 跳过重复发布相同数据。查询数据是纯 schema 数据（不含 Map、Set 或 Date），
      // 所以比较其 JSON 形式是可靠的。
      const data = JSON.stringify(loaded.data);
      const unchanged = data === publishedData;
      publishedData = data;
      const snapshot: QuerySnapshot<T> = {
        status: "ready",
        revision: loaded.revision,
        data: loaded.data,
        refreshing: false,
        error: null,
      };
      settled = snapshot;
      for (const handle of handles) {
        if (unchanged && handle.getSnapshot().status === "ready") continue;
        handle.publish(snapshot);
      }
    } catch {
      if (read !== latestRead) return;
      // A late observer should load rather than start in the error state.
      settled = null;
      for (const handle of handles) {
        const current = handle.getSnapshot();
        handle.publish({
          status: "error",
          revision: current.revision,
          data: current.data,
          refreshing: false,
          error: { code: "unavailable", retryable: true },
        });
      }
    }
  }

  async function refresh() {
    if (handles.size === 0) return;
    if (!inFlight) return startLoad();
    followUp ??= inFlight.then(() => {
      followUp = null;
      return handles.size > 0 ? startLoad() : undefined;
    });
    return followUp;
  }

  function startLoad() {
    for (const handle of handles) {
      const current = handle.getSnapshot();
      if (current.status === "loading" && !current.refreshing) {
        handle.publish({ ...current, refreshing: true });
      }
    }
    inFlight = runLoad().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    handles,
    observe() {
      const handle = createHandle<T>(settled);
      handles.add(handle);
      refresh().catch(() => undefined);
      return {
        getSnapshot: () => handle.getSnapshot(),
        subscribe: (listener) => handle.subscribe(listener),
        close: () => {
          handle.close();
          handles.delete(handle);
          if (handles.size === 0) onEmpty();
        },
      };
    },
    refresh,
    close() {
      for (const handle of handles) handle.close();
      handles.clear();
    },
  };
}

function createHandle<T>(seed: QuerySnapshot<T> | null): MutableHandle<T> {
  let snapshot: QuerySnapshot<T> = seed ?? {
    status: "loading",
    revision: null,
    data: null,
    refreshing: true,
    error: null,
  };
  const listeners = new Set<() => void>();
  let closed = false;
  return {
    getSnapshot() {
      return snapshot;
    },
    publish(next) {
      if (closed) return;
      if (snapshotEquals(snapshot, next)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}

function snapshotEquals<T>(left: QuerySnapshot<T>, right: QuerySnapshot<T>) {
  if (left.status !== right.status) return false;
  if (left.refreshing !== right.refreshing) return false;
  if ((left.error?.code ?? null) !== (right.error?.code ?? null)) return false;
  if (left.revision && right.revision) {
    return (
      revisionEquals(left.revision, right.revision) &&
      left.status === right.status
    );
  }
  return left.revision === right.revision && left.data === right.data;
}
