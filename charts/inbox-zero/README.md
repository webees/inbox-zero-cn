# Inbox Zero Helm Chart

此 chart 将 Docker Compose 自托管栈映射到 Kubernetes：

- 用于 Next.js 应用的 `web` Deployment
- 用于可选 BullMQ worker 的 `worker` Deployment
- 用于计划端点的 CronJobs
- 用于演示的可选内置 Postgres、Redis 和 Redis HTTP 桥接
- 用于生产的托管 Postgres 和 Redis 配置
- 可选的 Ingress 和 ServiceAccount 资源

生产环境请使用托管 Postgres 和托管 Redis。内置的 StatefulSets 面向演示和小型自托管安装，不适用于需要备份、故障转移、监控和经过测试的恢复的生产工作负载。

## 文档

有关安装和运维，请参阅 Kubernetes 托管指南：

- [Kubernetes 部署](../../docs/hosting/kubernetes.mdx)
- [环境变量](../../docs/hosting/environment-variables.mdx)

## 安装

```bash
helm upgrade --install inbox-zero ./charts/inbox-zero \
  -n inbox-zero \
  --create-namespace \
  -f values.prod.yaml
```

## 生产形态

通过现有的 Kubernetes Secret 使用托管数据服务：

```yaml
externalDatabase:
  enabled: true
  existingSecret:
    name: inbox-zero-database

externalRedis:
  enabled: true
  existingSecret:
    name: inbox-zero-redis

existingSecret: inbox-zero-secrets
```

应用环境变量键应放在 `inbox-zero-secrets` 中；完整列表请参阅环境变量参考。

## 演示数据服务

内置的 Postgres、Redis 和 Redis HTTP 需要显式设置密钥值：

```yaml
postgresql:
  auth:
    password: replace-with-random-value

redis:
  auth:
    password: replace-with-random-value

redisHttp:
  token: replace-with-random-value
```
