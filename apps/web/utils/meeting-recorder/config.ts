import type { PremiumTier } from "@/generated/prisma/enums";

// 让账号有权使用记录助手的套餐。预约机器人对通话中的所有人可见，
// 且按机器人计费，因此每个可能把机器人放入会议中的层
// 都必须与生成摘要的层保持一致。
export const MEETING_RECORDER_MIN_TIER: PremiumTier = "PLUS_MONTHLY";

// 机器人必须在通话开始前预约，因此 cron 会多往前看一个
// 我们希望提前量的间隔。
export const RECONCILE_WINDOW_MINUTES = 35;

// 用户可以提前多久查看并覆盖单场会议。
export const MEETING_LOOKAHEAD_HOURS = 48;

export const MAX_EVENTS_PER_PROVIDER = 50;

// 长于处理路由的 maxDuration，因此仅仅是运行缓慢的任务
// 不会在其仍在进行时被拾取或重新排队。
export const STUCK_PROCESSING_MINUTES = 15;

// 转录长达一小时的通话需要一段时间，因此要等到远超
// 转录通常应到达的时间点后再重新请求。过于急切地重试
// 有对同一份转录重复付费的风险。
export const STUCK_TRANSCRIPT_REQUEST_MINUTES = 90;

// 每次处理尝试都会运行摘要模型，因此每次都失败的会议
// 必须停止重试，而不是永远计费。
export const MAX_PROCESSING_ATTEMPTS = 5;

// 比这更旧的内容都不值得重试，而限制清扫范围可防止
// 堆积的死行挤占那些确实卡住的会议。
export const PROCESSING_RETRY_WINDOW_HOURS = 48;
