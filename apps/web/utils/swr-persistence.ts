const STORAGE_PREFIX = "inbox-zero:swr:v2:";

// 这些 hook 使用不按账号隔离的纯字符串 SWR 键（账号通过请求头传递），
// 因此快照改为按 emailAccountId 进行命名空间隔离。
export const PERSISTED_SWR_KEYS = [
  "/api/labels",
  "/api/user/folders",
  "/api/mail/settings",
] as const;

type SwrCacheState = {
  data?: unknown;
  isLoading?: boolean;
  isValidating?: boolean;
};

// 同时匹配普通的 Map 和 SWR 的 Cache 接口。
type ReadableCache = {
  get(key: string): SwrCacheState | undefined;
};

// 由清理函数设置，这样后续的 pagehide/visibility 快照就无法从仍然
// 温热的内存缓存中恢复已清理的数据 —— 退出登录的重定向本身会触发
// pagehide。模块状态会在下次页面加载时重置，这正是该屏蔽所需的生命周期。
let allPersistenceBlocked = false;
const blockedAccountIds = new Set<string>();

export function readPersistedSwrEntries(
  emailAccountId: string | null | undefined,
): Map<string, SwrCacheState> {
  const entries = new Map<string, SwrCacheState>();
  if (!emailAccountId || typeof window === "undefined") return entries;

  for (const [key, data] of Object.entries(readRawSnapshot(emailAccountId))) {
    // 水合的数据按定义就是过期的；SWR 会在挂载时重新校验。
    entries.set(key, { data, isLoading: false, isValidating: false });
  }
  return entries;
}

export function persistSwrEntries(
  emailAccountId: string | null | undefined,
  cache: ReadableCache,
) {
  if (!emailAccountId || typeof window === "undefined") return;
  if (allPersistenceBlocked || blockedAccountIds.has(emailAccountId)) return;

  try {
    // 从已存储的快照初始化，这样只获取了白名单键中一部分的页面
    // 就不会在覆盖时丢掉其余部分。
    const snapshot = readRawSnapshot(emailAccountId);
    let hasData = false;
    for (const key of PERSISTED_SWR_KEYS) {
      const data = cache.get(key)?.data;
      if (data !== undefined) {
        snapshot[key] = data;
        hasData = true;
      }
    }
    if (!hasData) return;
    window.localStorage.setItem(
      storageKey(emailAccountId),
      JSON.stringify(snapshot),
    );
  } catch {
    // 配额或序列化失败绝不能破坏应用。
  }
}

export function clearPersistedSwrCache() {
  allPersistenceBlocked = true;
  if (typeof window === "undefined") return;
  try {
    for (const key of persistedStorageKeys()) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // 退出登录期间忽略存储失败。
  }
}

export function clearPersistedSwrCacheForAccount(emailAccountId: string) {
  blockedAccountIds.add(emailAccountId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(emailAccountId));
  } catch {
    // 忽略存储失败。
  }
}

/** Maps a localStorage key back to its account id; null for unrelated keys. */
export function accountIdFromSnapshotKey(key: string): string | null {
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  return key.slice(STORAGE_PREFIX.length) || null;
}

export function resetSwrPersistenceBlocksForTesting() {
  allPersistenceBlocked = false;
  blockedAccountIds.clear();
}

function storageKey(emailAccountId: string) {
  return `${STORAGE_PREFIX}${emailAccountId}`;
}

function readRawSnapshot(emailAccountId: string): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(storageKey(emailAccountId));
    if (!raw) return snapshot;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return snapshot;
    }
    for (const key of PERSISTED_SWR_KEYS) {
      const data = (parsed as Record<string, unknown>)[key];
      if (data !== undefined) snapshot[key] = data;
    }
  } catch {
    // 损坏的快照绝不能破坏应用。
  }
  return snapshot;
}

function persistedStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("inbox-zero:swr:")) keys.push(key);
  }
  return keys;
}
