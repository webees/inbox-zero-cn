"use client";

import { cn } from "@/utils";

type RadioCardOption<T extends string> = {
  value: T;
  label: string;
};

/**
 * 以行卡片形式呈现的 N 选一选择，适用于需要让所有选项
 * 都可见而非隐藏在 Select 后面的决策。
 *
 * 按设计只使用标签 — 每个选项下方都加描述会显得嘈杂。
 * 如果某个选项需要解释，那说明标签本身有问题。
 *
 * 基于原生单选按钮构建：方向键导航和单个 Tab 停靠点
 * 都是天然具备的。
 */
export function RadioCardGroup<T extends string>({
  name,
  ariaLabel,
  value,
  onChange,
  options,
  disabled,
}: {
  /** 必须在页面上唯一；用于将底层单选输入分组。 */
  name: string;
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  disabled?: boolean;
}) {
  return (
    <fieldset
      aria-label={ariaLabel}
      className="divide-y divide-border overflow-hidden rounded-xl border bg-card"
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <label
            key={option.value}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 transition-colors",
              disabled
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-accent/40",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />

            <span
              className={cn(
                "size-4 shrink-0 rounded-full border transition-colors",
                "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                selected
                  ? "border-[5px] border-primary bg-background"
                  : "border-input",
              )}
            />

            <span className="text-sm">{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
