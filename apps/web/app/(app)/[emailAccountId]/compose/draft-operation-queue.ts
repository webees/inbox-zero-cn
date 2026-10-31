const queues = new Map<string, Promise<unknown>>();

/**
 * 每次只为一个撰写会话运行邮箱草稿变更。Gmail 在每次变更时都会
 * 替换整封邮件，因此与附件上传重叠的文本保存可能会写回草稿，
 * 丢失新文件。按会话而不是组件作为键，这样已关闭撰写器的上传
 * 仍能按顺序完成。
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
