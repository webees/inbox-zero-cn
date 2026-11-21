import type { ReactNode } from "react";
import { ItemCard } from "@/components/ui/item";
import { cn } from "@/utils";

/**
 * 一个带边框的卡片，由分隔线隔开的 `Item` 行组成，适用于每一行
 * 都是一条记录而非独立卡片的列表。
 *
 * `divide-border` 是显式设置的，因为 `Item` 设置了 `border-transparent`；
 * 分隔选择器的优先级更高，但裸的 `divide-y` 会继承
 * 透明颜色而不渲染任何内容。
 */
export function ListCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ItemCard
      className={cn(
        "divide-y divide-border overflow-hidden [&>[data-slot=item]]:rounded-none",
        className,
      )}
    >
      {children}
    </ItemCard>
  );
}
