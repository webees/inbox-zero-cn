"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/utils";

/**
 * 将文本截断为单行，并在文本长度超过 maxLength 时
 * 于悬停时在 tooltip 中显示完整文本的组件。
 */
export function TruncatedTooltipText({
  text,
  maxLength,
  className,
}: {
  text: string;
  maxLength: number;
  className?: string;
}) {
  const isTooLong = text.length > maxLength;

  const content = <div className={cn("truncate", className)}>{text}</div>;

  if (!isTooLong) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-[400px] whitespace-pre-wrap break-words">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
