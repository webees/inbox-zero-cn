import { cn } from "@/utils";

// 对于仍将视频托管在 YouTube 上的营销页面，普通嵌入即可。
// 应用内演示使用 MuxVideo，因为它会上报播放进度。
export function YouTubeVideo({
  videoId,
  title,
  className,
  iframeClassName,
}: {
  videoId: string;
  title: string;
  className?: string;
  iframeClassName?: string;
}) {
  return (
    <div className={cn("aspect-video h-full w-full rounded-lg", className)}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`}
        title={title}
        className={cn("h-full w-full", iframeClassName)}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
