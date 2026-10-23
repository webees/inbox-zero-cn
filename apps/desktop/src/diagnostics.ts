import { randomUUID } from "node:crypto";
import { availableParallelism, homedir, totalmem } from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { MailDiagnostics } from "@inboxzero/mail-core/engine";
import type { MailStoreInspection } from "@inboxzero/mail-core/ports/mail-store";
import { MAIL_IPC_PROTOCOL_VERSION } from "@inboxzero/mail-core/protocol/mail-ipc";
import {
  app,
  BrowserWindow,
  clipboard,
  contentTracing,
  dialog,
  Notification,
  shell,
  type MessageBoxOptions,
  type TraceConfig,
} from "electron";
import {
  captureDesktopError,
  isDesktopSentryEnabled,
  sendDesktopDiagnostics,
} from "./sentry";

const RECORDING_MS = 30_000;
const MAIL_ENGINE_TIMEOUT_MS = 10_000;
const TRACE_FILE = "trace.json.gz";
const SNAPSHOT_FILE = "diagnostics.json";

// 主线程与渲染进程工作以及采样的 JS 调用栈的时间线类别。
// 绘制/图层快照和截图类别被排除在外，因为它们会捕获渲染后的像素和文本。
const TRACE_CONFIG: TraceConfig = {
  recording_mode: "record-continuously",
  trace_buffer_size_in_kb: 64 * 1024,
  included_categories: [
    "toplevel",
    "ipc",
    "electron",
    "v8.execute",
    "blink.user_timing",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.frame",
    "disabled-by-default-v8.cpu_profiler",
  ],
  excluded_categories: ["*"],
};

type MailEngineOwner = { handleIpc(payload: unknown): Promise<unknown> };

let recording = false;

export async function recordDesktopDiagnostics(input: {
  /** 当本地邮件引擎本次会话尚未启动时为 undefined。 */
  getMailOwner: () => MailEngineOwner | undefined;
  databasePath: string;
}) {
  if (recording) {
    await showMessage({
      type: "info",
      message: "诊断已在录制中",
      detail: "请等待当前录制完成。",
    });
    return;
  }
  recording = true;
  try {
    await recordDiagnostics(input);
  } catch (error) {
    captureDesktopError(error, { area: "diagnostics" });
    dialog.showErrorBox(
      "无法录制诊断",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    recording = false;
  }
}

export function diagnosticsFolderName(date: Date) {
  return `Inbox-Zero-Diagnostics-${date.toISOString().slice(0, 19).replaceAll(":", "-")}`;
}

/**
 * 只保留计数、状态和同步覆盖范围。消息、操作目标、命令负载和助手条目
 * 可能携带邮件内容，因此直接丢弃而不是过滤。
 */
export function summarizeMailEngine(
  inspection: MailStoreInspection,
  diagnostics: MailDiagnostics[],
) {
  return {
    status: "ok" as const,
    revision: inspection.revision,
    accounts: inspection.accounts.map((account) => {
      const accountDiagnostics = diagnostics.find(
        (item) => item.accountId === account.accountId,
      );
      return {
        accountId: account.accountId,
        provider: account.provider,
        connection: account.connection,
        syncStreams: inspection.streams.filter(
          (stream) => stream.accountId === account.accountId,
        ).length,
        coverage: inspection.coverage
          .filter((coverage) => coverage.accountId === account.accountId)
          .map((coverage) => ({
            scopeId: coverage.scopeId,
            metadata: coverage.metadata,
            content: coverage.content,
            indexedContent: coverage.indexedContent,
            lastCompletedSyncAtMs: coverage.lastCompletedSyncAtMs,
          })),
        queue: accountDiagnostics
          ? {
              pendingOperations: accountDiagnostics.pendingOperations,
              uncertainOperations: accountDiagnostics.uncertainOperations,
              pendingJobs: accountDiagnostics.pendingJobs,
              oldestPendingAtMs: accountDiagnostics.oldestPendingAtMs,
              commands: countBy(
                accountDiagnostics.commands,
                (command) => `${command.kind}:${command.status}`,
              ),
            }
          : null,
      };
    }),
  };
}

/**
 * 从 trace JSON 里的 URL 值中去掉查询字符串和片段。重写文本可以避免
 * 在主进程中解析可能达到数十兆字节的 trace。
 */
export function stripTraceUrlQueries(json: string) {
  return json.replace(/"(https?:\/\/[^"?#\\]*)[?#](?:[^"\\]|\\.)*"/gi, '"$1"');
}

/**
 * trace 中的本地文件路径包含操作系统用户名，形式有普通路径、JSON 转义路径
 * 以及文件 URL 路径（正斜杠、空格用 `%20` 表示）。
 */
export function redactHomeDirectory(
  json: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (!home) return json;
  const windows = platform === "win32";
  const fileUrlPath = pathToFileURL(home, { windows }).pathname.replace(
    /^\/(?=[A-Za-z]:)/,
    "",
  );
  const forms = [
    ...new Set([home, JSON.stringify(home).slice(1, -1), fileUrlPath]),
  ].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    forms.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    windows ? "gi" : "g",
  );
  return json.replace(pattern, "~");
}

async function recordDiagnostics({
  getMailOwner,
  databasePath,
}: {
  getMailOwner: () => MailEngineOwner | undefined;
  databasePath: string;
}) {
  const { response } = await showMessage({
    type: "info",
    buttons: ["开始", "取消"],
    defaultId: 0,
    cancelId: 1,
    message: "录制诊断",
    detail:
      "在你复现问题时，Inbox Zero 将录制 30 秒的性能数据。其中包含计时与应用状态，不包含邮件内容。",
  });
  if (response !== 0) return;

  const startedAt = new Date();
  const folder = path.join(
    app.getPath("downloads"),
    diagnosticsFolderName(startedAt),
  );
  // 应用指标里的 CPU 使用率覆盖自上次调用以来的时间，因此这次采样
  // 能让最后一次采样覆盖整个录制过程。
  const processesAtStart = app.getAppMetrics();
  await contentTracing.startRecording(TRACE_CONFIG);
  await waitForRecording();
  const rawTracePath = await contentTracing.stopRecording(
    path.join(app.getPath("temp"), `${diagnosticsFolderName(startedAt)}.json`),
  );
  const stoppedAt = new Date();

  let trace: string;
  try {
    await mkdir(folder, { recursive: true });
    trace = redactHomeDirectory(
      stripTraceUrlQueries(await readFile(rawTracePath, "utf8")),
      homedir(),
    );
  } finally {
    // 原始 trace 中仍含有 URL 查询和主目录路径。
    await rm(rawTracePath, { force: true });
  }
  const traceData = await promisify(gzip)(trace);
  const snapshotData = Buffer.from(
    JSON.stringify(
      {
        startedAt: startedAt.toISOString(),
        durationMs: stoppedAt.getTime() - startedAt.getTime(),
        app: { version: app.getVersion(), packaged: app.isPackaged },
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        os: {
          platform: process.platform,
          arch: process.arch,
          version: process.getSystemVersion(),
          cpuCount: availableParallelism(),
          totalMemoryBytes: totalmem(),
        },
        systemMemoryKb: process.getSystemMemoryInfo(),
        processesAtStart,
        processesAtEnd: app.getAppMetrics(),
        mailDatabaseBytes: await mailDatabaseSizes(databasePath),
        mailEngine: await collectMailEngine(getMailOwner),
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(folder, TRACE_FILE), traceData);
  await writeFile(path.join(folder, SNAPSHOT_FILE), snapshotData);
  shell.showItemInFolder(folder);

  if (!isDesktopSentryEnabled()) {
    await showMessage({
      type: "info",
      message: "诊断已保存",
      detail: `已保存至 ${folder}。请将这些文件发送给 Inbox Zero 支持团队。`,
    });
    return;
  }

  const send = await showMessage({
    type: "info",
    buttons: ["发送给 Inbox Zero", "完成"],
    defaultId: 0,
    cancelId: 1,
    message: "诊断已保存",
    detail: `已保存至 ${folder}。请将它们发送给 Inbox Zero，以便我们调查问题。`,
  });
  if (send.response !== 0) return;

  const eventId = await sendDesktopDiagnostics([
    { filename: TRACE_FILE, data: traceData },
    { filename: SNAPSHOT_FILE, data: snapshotData },
  ]);
  if (!eventId) {
    await showMessage({
      type: "warning",
      message: "无法发送诊断",
      detail: `请改为将 ${folder} 中的文件发送给 Inbox Zero 支持团队。`,
    });
    return;
  }
  const sent = await showMessage({
    type: "info",
    buttons: ["复制 ID", "完成"],
    defaultId: 0,
    cancelId: 1,
    message: "诊断已发送",
    detail: `联系支持时请提供此 ID：${eventId}`,
  });
  if (sent.response === 0) clipboard.writeText(eventId);
}

// 没有父窗口的消息框在 macOS 上会成为应用级模态，阻塞复现问题，
// 因此改用通知来展示进度。
function waitForRecording() {
  return new Promise<void>((resolve) => {
    const notification = Notification.isSupported()
      ? new Notification({
          title: "正在录制诊断",
          body: "请现在复现问题。录制将在 30 秒后停止，或点击立即停止。",
        })
      : null;
    const timer = setTimeout(finish, RECORDING_MS);
    function finish() {
      clearTimeout(timer);
      notification?.close();
      resolve();
    }
    notification?.on("click", finish);
    notification?.show();
  });
}

async function collectMailEngine(
  getMailOwner: () => MailEngineOwner | undefined,
) {
  const owner = getMailOwner();
  if (!owner) return { status: "not_started" as const };
  try {
    return await withTimeout(
      (async () => {
        const inspection = await callMailEngine<MailStoreInspection>(
          owner,
          "inspect",
          {},
        );
        const diagnostics = await Promise.all(
          inspection.accounts.map((account) =>
            callMailEngine<MailDiagnostics>(owner, "getDiagnostics", {
              accountId: account.accountId,
            }),
          ),
        );
        return summarizeMailEngine(inspection, diagnostics);
      })(),
      MAIL_ENGINE_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      status: "unavailable" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function callMailEngine<T>(
  owner: MailEngineOwner,
  method: "inspect" | "getDiagnostics",
  payload: Record<string, unknown>,
) {
  const response = (await owner.handleIpc({
    protocolVersion: MAIL_IPC_PROTOCOL_VERSION,
    requestId: `diagnostics-${randomUUID()}`,
    method,
    payload,
  })) as { status: string; result?: T };
  if (response.status !== "ok") {
    throw new Error(`邮件引擎 ${method} 返回了 ${response.status}`);
  }
  return response.result as T;
}

async function mailDatabaseSizes(databasePath: string) {
  const name = path.basename(databasePath);
  const sizes: Record<string, number | null> = {};
  for (const suffix of ["", "-wal", "-shm"]) {
    sizes[`${name}${suffix}`] = await stat(`${databasePath}${suffix}`).then(
      (file) => file.size,
      () => null,
    );
  }
  return sizes;
}

function showMessage(options: MessageBoxOptions) {
  const window = BrowserWindow.getFocusedWindow();
  return window
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`在 ${ms}ms 后超时`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}
