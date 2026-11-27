import {
  createHistogram,
  monitorEventLoopDelay,
  type RecordableHistogram,
} from "node:perf_hooks";

const EVENT_LOOP_RESOLUTION_MS = 20;
const NS_PER_MS = 1_000_000;

export type DurationSummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

/**
 * 采样本进程事件循环执行定时器的延迟。每次 `drain`
 * 会汇总自上次调用以来的样本。
 */
export function startEventLoopDelayMonitor() {
  const histogram = monitorEventLoopDelay({
    resolution: EVENT_LOOP_RESOLUTION_MS,
  });
  histogram.enable();
  return {
    // 样本是定时器两次触发之间的完整时长，因此空闲循环会把分辨率误报为延迟。
    drain: () => drainHistogram(histogram, EVENT_LOOP_RESOLUTION_MS),
  };
}

export function createDurationRecorder() {
  const histogram = createHistogram();
  return {
    record(durationMs: number) {
      histogram.record(Math.max(1, Math.round(durationMs * NS_PER_MS)));
    },
    drain: () => drainHistogram(histogram, 0),
  };
}

function drainHistogram(
  histogram: Pick<
    RecordableHistogram,
    "count" | "percentile" | "max" | "reset"
  >,
  offsetMs: number,
): DurationSummary | null {
  if (histogram.count === 0) return null;
  const toMs = (ns: number) =>
    Math.max(0, Math.round((ns / NS_PER_MS - offsetMs) * 10) / 10);
  const summary = {
    count: histogram.count,
    p50Ms: toMs(histogram.percentile(50)),
    p95Ms: toMs(histogram.percentile(95)),
    maxMs: toMs(histogram.max),
  };
  histogram.reset();
  return summary;
}
