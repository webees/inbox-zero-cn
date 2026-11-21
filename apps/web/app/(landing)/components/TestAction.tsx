"use client";

import { Button } from "@/components/ui/button";
import { testAction } from "./test-action";

export function TestActionButton() {
  return (
    <Button
      variant="destructive"
      onClick={async () => {
        try {
          const res = await testAction();
          alert(`操作已完成：${res}`);
        } catch (error) {
          alert(`操作失败：${error}`);
        }
      }}
    >
      测试操作
    </Button>
  );
}
