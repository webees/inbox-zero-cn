import { ensureAllMailSplit } from "@/utils/split-inbox/initial-splits";
import prisma from "@/utils/prisma";

export async function getMailSettings({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      mailLayout: true,
      mailExpandedPreview: true,
      mailSplits: {
        // createdAt 用于打破平局，这样标签页顺序不会在请求之间发生变动
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          order: true,
          matchAll: true,
          filters: {
            orderBy: { order: "asc" },
            select: { kind: true, value: true },
          },
        },
      },
    },
  });

  return {
    layout: emailAccount?.mailLayout ?? null,
    expandedPreview: emailAccount?.mailExpandedPreview ?? false,
    splits: ensureAllMailSplit(emailAccount?.mailSplits ?? []),
  };
}
