const colors = [
  "#ef4444", // 红色 500
  "#f97316", // 橙色 500
  "#f59e0b", // 琥珀色 500
  "#eab308", // 黄色 500
  "#84cc16", // 青柠色 500
  "#22c55e", // 绿色 500
  "#10b981", // 翡翠色 500
  "#14b8a6", // 青色 500
  "#06b6d4", // 天青色 500
  "#0ea5e9", // 天蓝色 500
  "#3b82f6", // 蓝色 500
  "#6366f1", // 靛蓝色 500
  "#8b5cf6", // 紫罗兰色 500
  "#a855f7", // 紫色 500
  "#d946ef", // 洋红色 500
  "#ec4899", // 粉色 500
  "#f43f5e", // 玫瑰色 500
];

export function getRandomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

export const COLORS = {
  analytics: {
    blue: "#006EFF80",
    purple: "#6410FF80",
    pink: "#C942B2",
    lightPink: "#C942B260",
    green: "#17A34A",
    lightGreen: "#17A34A60",
  },
  footer: {
    gray: "#4E4E4E",
  },
};
