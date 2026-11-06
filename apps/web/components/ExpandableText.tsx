"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/utils";

export function ExpandableText({
  text,
  maxLength = 280,
  className,
}: {
  text: string;
  maxLength?: number;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 仅在内容足够长时才添加展开/收起
  if (text.length < maxLength) {
    return <TextWrapper className={className}>{text}</TextWrapper>;
  }

  return (
    <TextWrapper className={className}>
      <div className="relative overflow-hidden">
        {/* 始终渲染完整文本，但在收起时添加遮罩 */}
        <motion.div
          initial={{ height: "4rem" }}
          animate={{ height: isExpanded ? "auto" : "4rem" }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className={isExpanded ? "" : "overflow-hidden"}
        >
          {text}
        </motion.div>

        {/* 收起时添加渐变遮罩以提示还有更多内容 */}
        {!isExpanded && (
          <div className="absolute bottom-0 left-0 h-6 w-full bg-gradient-to-t from-background to-transparent" />
        )}
      </div>

      <motion.button
        type="button"
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="mt-1 flex items-center text-xs text-muted-foreground hover:text-primary"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {isExpanded ? (
          <>
            <ChevronUpIcon className="mr-1 h-3 w-3" />
            收起
          </>
        ) : (
          <>
            <ChevronDownIcon className="mr-1 h-3 w-3" />
            展开
          </>
        )}
      </motion.button>
    </TextWrapper>
  );
}

function TextWrapper({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {children}
    </div>
  );
}
