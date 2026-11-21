# Tinybird AI 分析

此包包含用于发布和查询 AI 分析的 TypeScript 客户端。Tinybird 数据源和端点属于标准 Forward 项目的一部分，该项目记录在 [`../tinybird`](../tinybird/README.md) 中。

请从 `packages/tinybird/project` 运行所有 Tinybird CLI 命令，以便整个工作区一起验证和部署。

## AI 成本字段

- `cost`：平台支付的估算成本，来自我们的本地定价表（使用用户 API 密钥的流量为 `0`）
- `estimatedCost`：无论由谁支付，均根据我们的本地定价表估算的成本
- `providerReportedCost`：可用时，服务商报告的准确成本
- `providerUpstreamInferenceCost`：可用时，上游服务商的准确成本
- `providerCostSource`：内部来源键，描述服务商侧成本是如何得出的
- `isUserApiKey`：用户提供的 API 密钥为 `1`，平台密钥为 `0`
- `stepCount`：AI SDK 结果报告的总步骤数
- `toolCallCount`：所有已报告步骤中的工具调用总数
- 旧行（此 schema 变更之前）的 `estimatedCost` 和 `isUserApiKey` 为 `NULL`
