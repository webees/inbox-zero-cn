"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingContent } from "@/components/LoadingContent";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAdminTopSpenders } from "@/hooks/useAdminTopSpenders";
import type { GetAdminTopSpendersResponse } from "@/app/api/admin/top-spenders/route";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("en-US");
const SUB_CENT_USD = 0.01;

export function AdminTopSpenders() {
  const { data, isLoading, error } = useAdminTopSpenders();
  const topSpenders = data?.topSpenders ?? [];
  const modelSpend = data?.modelSpend ?? [];

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>支出排行榜</CardTitle>
        <CardDescription>
          最近 7 天。Nano-Limited 来自 Redis；用户账号为已连接的邮箱账号。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoadingContent loading={isLoading} error={error}>
          <div className="space-y-8">
            {topSpenders.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">排名</TableHead>
                    <TableHead>邮箱账号 ID</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>用户账号</TableHead>
                    <TableHead>热门模型</TableHead>
                    <TableHead>Nano-Limited</TableHead>
                    <TableHead className="text-right">成本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topSpenders.map((spender, index) => (
                    <TableRow
                      key={
                        ("userId" in spender
                          ? spender.userId
                          : spender.email) ?? index
                      }
                    >
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {spender.emailAccountId ?? "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">
                        {spender.email ?? "-"}
                      </TableCell>
                      <TableCell>
                        {spender.userEmailAccountCount ?? "-"}
                      </TableCell>
                      <TableCell>
                        <ModelSpendList modelSpend={spender.modelSpend} />
                      </TableCell>
                      <TableCell>
                        {spender.nanoLimitedBySpendGuard ? (
                          <Badge variant="red">是</Badge>
                        ) : (
                          <Badge variant="green">否</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCost(spender.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                过去 7 天没有记录到使用成本。
              </p>
            )}

            <section className="space-y-3">
              <div>
                <h3 className="font-medium text-sm">按模型支出</h3>
                <p className="text-muted-foreground text-sm">
                  Tinybird 平台支出。
                </p>
              </div>

              {modelSpend.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">排名</TableHead>
                      <TableHead>提供商</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">调用次数</TableHead>
                      <TableHead className="text-right">成本</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelSpend.map((model, index) => (
                      <TableRow key={`${model.provider}:${model.model}`}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {model.provider}
                        </TableCell>
                        <TableCell className="font-mono text-xs sm:text-sm">
                          {model.model}
                        </TableCell>
                        <TableCell className="text-right">
                          {numberFormatter.format(model.calls)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCost(model.cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  此时间窗口内 Tinybird 没有记录到模型支出。
                </p>
              )}
            </section>
          </div>
        </LoadingContent>
      </CardContent>
    </Card>
  );
}

type TopSpender = GetAdminTopSpendersResponse["topSpenders"][number];
type ModelSpend = TopSpender["modelSpend"];

function ModelSpendList({ modelSpend }: { modelSpend: ModelSpend }) {
  if (!modelSpend.length) {
    return <span className="text-muted-foreground text-sm">-</span>;
  }

  return (
    <div className="space-y-1">
      {modelSpend.map((model) => (
        <div
          className="flex max-w-72 justify-between gap-3 text-xs"
          key={`${model.provider}:${model.model}`}
        >
          <span className="truncate font-mono">
            {model.provider}/{model.model}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatCost(model.cost)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatCost(cost: number) {
  if (cost > 0 && cost < SUB_CENT_USD) return "<$0.01";

  return currencyFormatter.format(cost);
}
