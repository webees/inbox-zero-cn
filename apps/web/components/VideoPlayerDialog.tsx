"use client";

import type { ReactNode } from "react";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LazyMuxVideo } from "@/components/LazyMuxVideo";

// 宽度跟随视口并减去标题高度，以使 16:9 播放器保持在
// 居中的对话框内。固定播放器宽度若超过对话框
// 会导致视频被裁剪且偏离中心。
const dialogWidth = "min(94vw, calc((90vh - 9rem) * 16 / 9), 1200px)";

export function VideoPlayerDialog({
  title,
  description,
  muxPlaybackId,
  onVideoCompleted,
  onVideoProgress,
  onVideoStarted,
}: {
  title: string;
  description?: ReactNode;
  muxPlaybackId: string;
  onVideoCompleted?: () => void;
  onVideoProgress?: (progressPercent: number) => void;
  onVideoStarted?: () => void;
}) {
  return (
    <DialogContent
      className="max-w-none gap-4 bg-background p-6"
      style={{ width: dialogWidth }}
    >
      <DialogHeader className="text-left">
        <DialogTitle className="text-xl">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="text-base text-muted-foreground">
            {description}
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        )}
      </DialogHeader>
      <VideoPlayer
        title={title}
        muxPlaybackId={muxPlaybackId}
        onVideoCompleted={onVideoCompleted}
        onVideoProgress={onVideoProgress}
        onVideoStarted={onVideoStarted}
      />
    </DialogContent>
  );
}

function VideoPlayer({
  title,
  muxPlaybackId,
  onVideoCompleted,
  onVideoProgress,
  onVideoStarted,
}: {
  title: string;
  muxPlaybackId: string;
  onVideoCompleted?: () => void;
  onVideoProgress?: (progressPercent: number) => void;
  onVideoStarted?: () => void;
}) {
  return (
    <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-black">
      <LazyMuxVideo
        playbackId={muxPlaybackId}
        title={title}
        className="size-full"
        playerClassName="size-full"
        autoPlay
        onVideoCompleted={onVideoCompleted}
        onVideoProgress={onVideoProgress}
        onVideoStarted={onVideoStarted}
      />
    </div>
  );
}
