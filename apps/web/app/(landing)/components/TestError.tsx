"use client";

import { Button } from "@/components/ui/button";

export function TestErrorButton() {
  return (
    <Button
      variant="destructive"
      onClick={() => {
        throw new Error("Sentry 前端错误");
      }}
    >
      抛出错误
    </Button>
  );
}
