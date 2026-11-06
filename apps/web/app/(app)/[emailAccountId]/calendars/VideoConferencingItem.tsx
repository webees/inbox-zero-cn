import { Toggle } from "@/components/Toggle";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";

export function VideoConferencingItem({
  canAddVideo,
  videoEnabled,
  videoLabel,
  onChange,
}: {
  canAddVideo: boolean;
  videoEnabled: boolean;
  videoLabel: string | null;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>视频会议</ItemTitle>
        <ItemDescription>
          {videoLabel
            ? `将 ${videoLabel} 添加到日历活动中。`
            : "此日历无法使用视频链接。"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Toggle
          name="videoConferencing"
          ariaLabel="切换视频会议"
          enabled={canAddVideo && videoEnabled}
          disabled={!canAddVideo}
          onChange={onChange}
        />
      </ItemActions>
    </Item>
  );
}
