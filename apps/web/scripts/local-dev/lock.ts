import { createHash } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

export async function acquireLocalLock(path: string, appPort?: number) {
  // 崩溃后由内核释放此检出专用的租约。仅靠 PID 文件
  // 无法安全地仲裁并发的陈旧锁恢复。
  const port =
    49_152 +
    (createHash("sha256").update(path).digest().readUInt32BE(0) % 16_384);
  if (port === appPort)
    throw new Error(
      `应用端口 ${port} 已被保留给此检出的开发锁。请使用 --port 选择其他应用端口。`,
    );
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
        reject(
          new Error(
            `本地开发锁端口 ${port} 已被占用。请先停止另一个启动器或进程再重试。`,
          ),
        );
      else reject(error);
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  try {
    writeFileSync(path, String(process.pid), { mode: 0o600 });
  } catch (error) {
    server.close();
    throw error;
  }
  return async () => {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("[local] 无法删除信息性启动器 PID 文件", error);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
