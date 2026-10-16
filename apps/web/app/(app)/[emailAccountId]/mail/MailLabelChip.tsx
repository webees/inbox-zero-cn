"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { XIcon } from "lucide-react";
import type { EmailLabel } from "@/providers/email-label-types";
import { cn } from "@/utils";

export type MailLabelChipProps = {
  name: string;
  /** Gmail 或 Outlook 分配的颜色。 */
  color?: EmailLabel["color"];
  /** 可交互：点击标签会跳转到该标签的视图。 */
  href?: string;
  /** 可交互：悬停时显示一个 `×`，用于移除该标签。 */
  onRemove?: () => void;
  className?: string;
};

/**
 * 标签胶囊。服务商提供的颜色优先；否则颜色由名称决定，
 * 这样同一个标签在任何地方看起来都一致。没有 `href` 或 `onRemove`
 * 时标签是不可交互的；两者各自带来一种交互——名称上的链接，
 * 以及悬停时显示的 `×`。
 */
export function MailLabelChip({
  name,
  color,
  href,
  onRemove,
  className,
}: MailLabelChipProps) {
  const providerStyle = providerColorStyle(color);

  return (
    <span
      className={cn(
        "group/chip relative isolate inline-flex min-w-0 max-w-full items-center gap-0.5 whitespace-nowrap rounded-md border border-transparent px-1.5 py-px text-xs leading-4 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:-z-10 before:rounded-md before:border before:transition-[right] before:content-['']",
        providerStyle
          ? "text-[var(--mail-label-text-color)] before:border-[var(--mail-label-background-color)] before:bg-[var(--mail-label-background-color)]"
          : CHIP_CLASSES[chipColorForLabel(name)],
        onRemove
          ? "before:right-3 hover:before:right-0 focus-within:before:right-0"
          : "before:right-0",
        className,
      )}
      style={providerStyle}
    >
      {href ? (
        <Link className="min-w-0 truncate hover:underline" href={href}>
          {name}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
      {onRemove ? (
        <button
          aria-label={`移除 ${name} 标签`}
          className="pointer-events-none -mr-0.5 shrink-0 rounded-sm opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/chip:pointer-events-auto group-hover/chip:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * 标签调色板，也是唯一写明它的地方：`ChipColor` 与
 * `CHIP_COLORS` 都由这些键推导而来，因此在这里新增颜色时，
 * 哈希会立刻采用它。
 *
 * bg / border / text，仅浅色：Mail 调色板没有深色变体。
 */
const CHIP_CLASSES = {
  blue: "text-primary before:border-new-blue-150 before:bg-new-blue-50",
  green:
    "text-new-green-600 before:border-new-green-150 before:bg-new-green-50",
  purple:
    "text-new-purple-600 before:border-new-purple-200 before:bg-new-purple-50",
  orange:
    "text-new-orange-600 before:border-new-orange-150 before:bg-new-orange-50",
  red: "text-new-red-500 before:border-new-red-150 before:bg-new-red-50",
  gray: "text-new-gray-550 before:border-new-gray-150 before:bg-new-gray-100",
  cyan: "text-new-cyan-700 before:border-new-cyan-200 before:bg-new-cyan-100",
  yellow:
    "text-new-yellow-600 before:border-new-yellow-150 before:bg-new-yellow-50",
};

type ChipColor = keyof typeof CHIP_CLASSES;

/** 哈希可能落到的颜色。导出以便测试直接针对调色板本身进行断言。 */
export const CHIP_COLORS = Object.keys(CHIP_CLASSES) as ChipColor[];

/** 转为小写，这样无论服务商如何变换大小写，标签都保持同一颜色。 */
const NAMED_CHIP_COLORS: Record<string, ChipColor> = {
  "to reply": "blue",
  notification: "green",
  receipt: "orange",
  "cold email": "red",
  newsletter: "purple",
  actioned: "orange",
  "awaiting reply": "cyan",
  calendar: "yellow",
  "customer feedback": "purple",
};

/**
 * 标签所呈现的颜色。产品标签有固定颜色；其他一切都通过哈希映射到调色板，
 * 这样用户自己的标签会永远保持同一颜色，而不会在多次渲染之间闪烁。
 */
export function chipColorForLabel(name: string): ChipColor {
  // 使用与命名查找相同的规范化键进行哈希，这样当服务商改变大小写或
  // 空白时，标签颜色不会变化。
  const key = name.trim().toLowerCase();
  const named = NAMED_CHIP_COLORS[key];
  if (named) return named;

  // djb2
  let hash = 5381;
  for (let index = 0; index < key.length; index++) {
    hash = (hash * 33 + key.charCodeAt(index)) % 0xff_ff_ff;
  }

  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

type MailLabelChipStyle = CSSProperties & {
  "--mail-label-background-color": string;
  "--mail-label-text-color": string;
};

function providerColorStyle(
  color: EmailLabel["color"],
): MailLabelChipStyle | undefined {
  if (!color?.backgroundColor) return;

  const textColor =
    color.textColor || contrastingTextColor(color.backgroundColor);
  if (!textColor) return;

  return {
    "--mail-label-background-color": color.backgroundColor,
    "--mail-label-text-color": textColor,
  };
}

export function contrastingTextColor(backgroundColor: string) {
  const hex = backgroundColor.trim();
  if (!/^#[\da-f]{6}$/i.test(hex)) return;

  const red = linearColorChannel(hex.slice(1, 3));
  const green = linearColorChannel(hex.slice(3, 5));
  const blue = linearColorChannel(hex.slice(5, 7));
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);

  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

function linearColorChannel(hex: string) {
  const channel = Number.parseInt(hex, 16) / 255;
  return channel <= 0.040_45
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}
