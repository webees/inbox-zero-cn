const queues = new Map<string, Promise<unknown>>();

/**
 * 每次只为一个撰写会话执行邮箱草稿变更。Gmail 每次变更都会替换整封邮件，
 * 因此与附件上传重叠的文本保存可能会在没有新文件的情况下写回草稿。
 * 按会话而非组件作为键，这样已关闭的撰写器上传仍能按顺序完成。
 */
export function enqueueDraftOperation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const tail = next.catch(() => undefined);
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

export async function waitForDraftOperations(key: string) {
  await queues.get(key);
}

export function hasPendingDraftOperations(key: string) {
  return queues.has(key);
}
