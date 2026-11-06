"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toastError } from "@/components/Toast";
import { Button } from "@/components/ui/button";

export function CopyButton({
  value,
  label,
  iconOnly,
}: {
  value: string;
  label: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <>
      <Button
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
        size={iconOnly ? "icon" : "sm"}
        aria-label={iconOnly ? label : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toastError({ description: "无法复制到剪贴板" });
          }
        }}
      >
        <Icon className={iconOnly ? "size-4" : "mr-2 size-4"} />
        {!iconOnly && (copied ? "已复制" : label)}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "已复制" : ""}
      </span>
    </>
  );
}
