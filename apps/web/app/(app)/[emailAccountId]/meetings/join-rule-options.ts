import { MeetingJoinRule } from "@/generated/prisma/enums";

export const JOIN_RULE_OPTIONS = [
  { value: MeetingJoinRule.ALL, label: "所有带视频链接的通话" },
  {
    value: MeetingJoinRule.EXTERNAL_ONLY,
    label: "只有公司外部人员参与的通话",
  },
  { value: MeetingJoinRule.HOST_ONLY, label: "只有我组织的通话" },
  { value: MeetingJoinRule.OFF, label: "只有我手动开启的通话" },
];
