import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import {
  MEETING_BOT_DISPLAY_NAME,
  MeetingBotProviderError,
  type MeetingBotProvider,
  type NormalizedTranscript,
} from "@/utils/meeting-recorder/bot-provider";
import { normalizeRecallTranscript } from "@/utils/recall/transcript";
import {
  recallBotSchema,
  recallBotStatusSchema,
  recallTranscriptDownloadSchema,
  recallTranscriptSchema,
} from "@/utils/recall/types";

// Recall 支持的记录所存储的 `botProvider` 值。永远
// 固定：即使默认服务商变更，历史行也保留此值。
export const RECALL_BOT_PROVIDER = "recall";

/**
 * Recall 是否可以端到端使用。仅有 API 密钥还不够：
 * 没有 webhook 密钥，我们会预约一些其生命周期事件永远无法验证的
 * 机器人，因此这两者始终成对配置。
 */
export function isRecallConfigured(): boolean {
  return Boolean(env.RECALL_API_KEY && env.RECALL_WEBHOOK_SECRET);
}

const DEFAULT_RECALL_REGION = "us-west-2";
const ENDED_BOT_STATUS_CODES = new Set(["call_ended", "done", "fatal"]);

// 使用参与者在线情况来结束成功的录制；日历时长
// 并不是通话的实际时长。
const EVERYONE_LEFT_TIMEOUT_SECONDS = 2;
const MEETING_BOT_NAME_MATCHES = [
  "notetaker",
  "recorder",
  "copilot",
  "grain",
  "fellow",
  "tl;dv",
  "read.ai",
  "fathom",
  "otter.ai",
  "fireflies.ai",
];

// 仅用于指向本地模拟器，与 GOOGLE_BASE_URL 相同。
function getRecallApiBase(): string {
  if (env.RECALL_BASE_URL) {
    return env.RECALL_BASE_URL.replace(/\/+$/, "");
  }

  return `https://${env.RECALL_REGION ?? DEFAULT_RECALL_REGION}.recall.ai/api/v1`;
}

class RecallApiError extends MeetingBotProviderError {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, path: string) {
    super(`Recall API ${status}（${path}）：${body}`, isPermanent(status));
    this.name = "RecallApiError";
    this.status = status;
    this.body = body;
  }
}

export class RecallBotProvider implements MeetingBotProvider {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async scheduleBot({
    botName = MEETING_BOT_DISPLAY_NAME,
    meetingUrl,
    joinAt,
  }: {
    botName?: string;
    meetingUrl: string;
    joinAt: Date;
  }): Promise<{ externalBotId: string }> {
    const cameraImage = await getMeetingBotCameraImage().catch((error) => {
      this.logger.warn("会议机器人摄像头图像不可用；将在无视频的情况下安排", {
        error,
      });
      return null;
    });

    // 这里刻意不配置转录：`recallai_async` 不是
    // 机器人创建服务商。异步转录按每条记录单独请求，
    // 在 `recording.done` 之后，通过下面的 createTranscript。
    // https://docs.recall.ai/docs/bot-async-transcription
    const response = await this.request("/bot/", {
      method: "POST",
      body: {
        meeting_url: meetingUrl,
        bot_name: botName,
        // Recall 会拒绝过去的 `join_at`。省略它会创建一个临时机器人，
        // 立即加入正在进行的会议。
        ...(joinAt.getTime() > Date.now() && { join_at: joinAt.toISOString() }),
        automatic_leave: {
          everyone_left_timeout: { timeout: EVERYONE_LEFT_TIMEOUT_SECONDS },
          // 时间单位为秒。
          bot_detection: {
            using_participant_names: {
              matches: MEETING_BOT_NAME_MATCHES,
              activate_after: 1,
              timeout: 10,
            },
            using_participant_events: {
              // 给真实与会者发言或共享的时间，然后再将
              // 不活跃作为陌生机器人的回退信号。
              activate_after: 120,
              timeout: 10,
            },
          },
        },
        ...(cameraImage && {
          automatic_video_output: {
            in_call_recording: {
              kind: "jpeg",
              b64_data: cameraImage,
            },
          },
        }),
      },
    });

    const bot = recallBotSchema.parse(response);
    return { externalBotId: bot.id };
  }

  async updateBot(
    externalBotId: string,
    {
      botName,
      joinAt,
      meetingUrl,
    }: { botName: string; joinAt?: Date; meetingUrl?: string },
  ): Promise<{ externalBotId: string }> {
    try {
      await this.request(`/bot/${externalBotId}/`, {
        method: "PATCH",
        body: {
          ...(botName && { bot_name: botName }),
          ...(joinAt && { join_at: joinAt.toISOString() }),
          ...(meetingUrl && { meeting_url: meetingUrl }),
        },
      });
      return { externalBotId };
    } catch (error) {
      if (
        !(
          joinAt &&
          meetingUrl &&
          (isRejectedReschedule(error) || isMissing(error))
        )
      ) {
        throw error;
      }

      await this.cancelBot(externalBotId);
      return this.scheduleBot({ botName, meetingUrl, joinAt });
    }
  }

  async cancelBot(externalBotId: string): Promise<void> {
    try {
      await this.request(`/bot/${externalBotId}/`, { method: "DELETE" });
    } catch (error) {
      if (isMissing(error)) {
        this.logger.info("Recall 机器人已不存在", {
          externalBotId,
        });
        return;
      }

      if (!isDispatched(error)) throw error;

      try {
        await this.request(`/bot/${externalBotId}/leave_call/`, {
          method: "POST",
        });
      } catch (leaveError) {
        if (
          !isAlreadyGoneFromCall(leaveError) &&
          !(isUnstarted(leaveError) && (await this.hasBotEnded(externalBotId)))
        ) {
          throw leaveError;
        }
        this.logger.info("Recall 机器人已离开通话", {
          externalBotId,
        });
      }
    }
  }

  // 一个从未加入就结束的机器人既无法删除也无法让它离开，
  // 但仍处于等待加入状态的机器人必须持续重试。
  private async hasBotEnded(externalBotId: string): Promise<boolean> {
    const bot = recallBotStatusSchema.parse(
      await this.request(`/bot/${externalBotId}/`, { method: "GET" }),
    );
    const latest = bot.status_changes.at(-1)?.code;
    return latest ? ENDED_BOT_STATUS_CODES.has(latest) : false;
  }

  async createTranscript(externalRecordingId: string): Promise<void> {
    // 说话人分离在这里位于顶层，而非 provider 对象内部，
    // 而在实时服务商创建机器人时它是放在那里。
    await this.request(`/recording/${externalRecordingId}/create_transcript/`, {
      method: "POST",
      body: {
        provider: { recallai_async: { language_code: "auto" } },
        diarization: { use_separate_streams_when_available: true },
      },
    });
  }

  async fetchTranscript(
    externalTranscriptId: string,
  ): Promise<NormalizedTranscript> {
    // webhook 中的下载 URL 是短时效的，因此始终向 Recall 索取
    // 一个新的预签名 URL，而不是存储收到的那个。
    const transcript = recallTranscriptSchema.parse(
      await this.request(`/transcript/${externalTranscriptId}/`, {
        method: "GET",
      }),
    );

    const downloadUrl = transcript.data?.download_url;
    if (!downloadUrl) {
      throw new Error(`Recall 转录 ${externalTranscriptId} 没有下载 URL`);
    }

    const download = await fetch(downloadUrl);
    if (!download.ok) {
      throw new RecallApiError(
        download.status,
        await download.text(),
        "transcript download",
      );
    }

    return normalizeRecallTranscript(
      recallTranscriptDownloadSchema.parse(await download.json()),
    );
  }

  async deleteMedia(externalBotId: string): Promise<void> {
    try {
      await this.request(`/bot/${externalBotId}/delete_media/`, {
        method: "POST",
      });
    } catch (error) {
      if (error instanceof RecallApiError && error.status === 404) {
        this.logger.info("Recall 媒体已删除", { externalBotId });
        return;
      }
      throw error;
    }
  }

  private async request(
    path: string,
    { method, body }: { method: string; body?: unknown },
  ): Promise<unknown> {
    if (!env.RECALL_API_KEY) {
      throw new Error("未配置 RECALL_API_KEY");
    }

    const response = await fetch(`${getRecallApiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Token ${env.RECALL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new RecallApiError(response.status, await response.text(), path);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

function isRejectedReschedule(error: unknown): boolean {
  return (
    error instanceof RecallApiError &&
    error.status === 400 &&
    getRecallErrorCode(error) === "update_bot_failed"
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof RecallApiError && error.status === 404;
}

function isDispatched(error: unknown): boolean {
  return (
    error instanceof RecallApiError &&
    (error.status === 400 || error.status === 405) &&
    getRecallErrorCode(error) === "cannot_delete_bot"
  );
}

function isUnstarted(error: unknown): boolean {
  return (
    error instanceof RecallApiError &&
    error.status === 400 &&
    getRecallErrorCode(error) === "cannot_command_unstarted_bot"
  );
}

function isAlreadyGoneFromCall(error: unknown): boolean {
  if (isMissing(error)) return true;
  if (!(error instanceof RecallApiError) || error.status !== 400) return false;

  const code = getRecallErrorCode(error);
  return code === "cannot_command_completed_bot";
}

function getRecallErrorCode(error: RecallApiError): string | null {
  try {
    const body = JSON.parse(error.body) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * 重放同一请求是否可能成功。大多数 4xx 响应
 * 意味着请求本身有误（会议 URL 错误、平台不受支持），但
 * 限流和超时也是 4xx，但会自行恢复，若把它们当作
 * 永久性错误，就会放弃占用并跳过会议。
 */
function isPermanent(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return false;
  return status >= 400 && status < 500;
}

let meetingBotCameraImagePromise: Promise<string> | undefined;

function getMeetingBotCameraImage(): Promise<string> {
  meetingBotCameraImagePromise ??= readMeetingBotCameraImage().catch(
    (error) => {
      meetingBotCameraImagePromise = undefined;
      throw error;
    },
  );
  return meetingBotCameraImagePromise;
}

async function readMeetingBotCameraImage(): Promise<string> {
  try {
    return await readFile(
      join(
        process.cwd(),
        "public",
        "images",
        "meetings",
        "inbox-zero-notetaker.jpg",
      ),
      "base64",
    );
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  try {
    return await readFile(
      join(
        process.cwd(),
        "apps",
        "web",
        "public",
        "images",
        "meetings",
        "inbox-zero-notetaker.jpg",
      ),
      "base64",
    );
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  throw new Error("缺少 Recall 会议机器人摄像头图像");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
