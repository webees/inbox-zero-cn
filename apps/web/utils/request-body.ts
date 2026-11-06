/**
 * 读取声明了大小的请求体。一旦请求体超过该大小就立即停止，
 * 因此比声明更大的请求体永远不会被缓冲。
 */
export async function readRequestBytes(request: Request, maxBytes: number) {
  const header = request.headers.get("content-length");
  const declared = Number(header);
  if (!header || !Number.isSafeInteger(declared) || declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  const bytes = new Uint8Array(declared);
  let received = 0;
  const reader = request.body?.getReader();
  if (!reader) return declared === 0 ? bytes : null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > declared) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    bytes.set(value, received);
    received += value.byteLength;
  }
  return received === declared ? bytes : null;
}
