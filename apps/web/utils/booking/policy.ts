// 将可用时段锚定到每 30 分钟，这样即使在 :00/:30 网格上的空闲窗口
// 与通话时长对不齐时也能显示出来
//（例如，45 分钟的通话否则会按 9:00、9:45、10:30 递增，从而
// 掩盖 10:00-11:00 的空档）。
const SLOT_ANCHOR_MINUTES = 30;

export function getSlotIntervalMinutes(durationMinutes: number) {
  return Math.min(durationMinutes, SLOT_ANCHOR_MINUTES);
}
