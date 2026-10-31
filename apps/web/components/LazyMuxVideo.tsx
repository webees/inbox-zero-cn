"use client";

import dynamic from "next/dynamic";
import { Loader2Icon } from "lucide-react";

// Mux 播放器体积较大，通常只在用户打开视频后才需要。
// 渲染此组件而非 MuxVideo 可以让播放器在真正挂载前
// 不进入页面打包产物。
export const LazyMuxVideo = dynamic(
  () => import("@/components/MuxVideo").then((mod) => mod.MuxVideo),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="flex size-full items-center justify-center">
        <span className="sr-only">正在加载视频</span>
        <Loader2Icon
          aria-hidden="true"
          className="size-8 animate-spin text-white/70"
        />
      </div>
    ),
  },
);
