import { format } from "date-fns/format";
import sumBy from "lodash/sumBy";
import prisma from "@/utils/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { StatsByPeriodQuery } from "@/app/api/user/stats/by-period/validation";

export type StatsByPeriodResponse = Awaited<
  ReturnType<typeof getStatsByPeriod>
>;

async function getEmailStatsByPeriod(
  options: StatsByPeriodQuery & { emailAccountId: string },
) {
  const { period, fromDate, toDate, emailAccountId } = options;

  // 构建日期条件，避免以 AND 开头
  const dateConditions: Prisma.Sql[] = [];
  if (fromDate) {
    dateConditions.push(Prisma.sql`date >= ${new Date(fromDate)}`);
  }
  if (toDate) {
    dateConditions.push(Prisma.sql`date <= ${new Date(toDate)}`);
  }

  // 使用原生查询，并提供正确类型的参数
  type StatsResult = {
    startOfPeriod: Date;
    totalCount: bigint;
    inboxCount: bigint;
    readCount: bigint;
    sentCount: bigint;
    unread: bigint;
    notInbox: bigint;
  };

  // 正确构建 WHERE 子句
  const whereClause = Prisma.sql`WHERE "emailAccountId" = ${emailAccountId}`;
  const dateClause =
    dateConditions.length > 0
      ? Prisma.sql` AND ${Prisma.join(dateConditions, " AND ")}`
      : Prisma.sql``;

  return prisma.$queryRaw<StatsResult[]>`
    SELECT
      DATE_TRUNC(${period}, date) AS "startOfPeriod",
      COUNT(*) AS "totalCount",
      SUM(CASE WHEN inbox = true THEN 1 ELSE 0 END) AS "inboxCount",
      SUM(CASE WHEN inbox = false THEN 1 ELSE 0 END) AS "notInbox",
      SUM(CASE WHEN read = true THEN 1 ELSE 0 END) AS "readCount",
      SUM(CASE WHEN read = false THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN sent = true THEN 1 ELSE 0 END) AS "sentCount"
    FROM "EmailMessage"
    ${whereClause}${dateClause}
    GROUP BY "startOfPeriod"
    ORDER BY "startOfPeriod"
  `;
}

export async function getStatsByPeriod(
  options: StatsByPeriodQuery & {
    emailAccountId: string;
  },
) {
  // 用单次查询获取所有统计数据
  const stats = await getEmailStatsByPeriod(options);

  // 转换统计数据以匹配预期格式
  const formattedStats = stats.map((stat) => {
    const startOfPeriodFormatted = format(stat.startOfPeriod, "LLL dd, y");

    return {
      startOfPeriod: startOfPeriodFormatted,
      All: Number(stat.totalCount),
      Sent: Number(stat.sentCount),
      Read: Number(stat.readCount),
      Unread: Number(stat.unread),
      Unarchived: Number(stat.inboxCount),
      Archived: Number(stat.notInbox),
    };
  });

  // Calculate totals
  const totalAll = sumBy(stats, (stat) => Number(stat.totalCount));
  const totalInbox = sumBy(stats, (stat) => Number(stat.inboxCount));
  const totalRead = sumBy(stats, (stat) => Number(stat.readCount));
  const totalSent = sumBy(stats, (stat) => Number(stat.sentCount));

  return {
    result: formattedStats,
    allCount: totalAll,
    inboxCount: totalInbox,
    readCount: totalRead,
    sentCount: totalSent,
  };
}
