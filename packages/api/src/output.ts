import type {
  ResponseTimeResponse,
  Rule,
  StatsByPeriodResponse,
} from "./api-types";

export function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printRulesTable(rules: Rule[]) {
  if (rules.length === 0) {
    process.stdout.write("未找到规则。\n");
    return;
  }

  process.stdout.write("ID\t启用\t操作\t名称\n");
  for (const rule of rules) {
    process.stdout.write(
      `${rule.id}\t${rule.enabled ? "是" : "否"}\t${rule.actions.length}\t${rule.name}\n`,
    );
  }
}

export function printStatsByPeriod(result: StatsByPeriodResponse) {
  process.stdout.write(
    `邮件：共 ${result.allCount} 封，${result.inboxCount} 封收件箱，${result.readCount} 封已读，${result.sentCount} 封已发送\n`,
  );

  for (const period of result.result) {
    process.stdout.write(
      `${period.startOfPeriod}: 全部=${period.All} 未读=${period.Unread} 已归档=${period.Archived}\n`,
    );
  }
}

export function printResponseTime(result: ResponseTimeResponse) {
  process.stdout.write(
    `已分析邮件：${result.emailsAnalyzed}/${result.maxEmailsCap}\n`,
  );
  process.stdout.write(
    `响应时间中位数：${result.summary.medianResponseTime} 分钟\n`,
  );
  process.stdout.write(
    `平均响应时间：${result.summary.averageResponseTime} 分钟\n`,
  );
  process.stdout.write(`1 小时内：${result.summary.within1Hour}%\n`);
}
