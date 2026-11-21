# AWS 图片代理

此应用为 Inbox Zero 图片代理契约提供 AWS Lambda 适配器。

接受的请求形式：

- 签名模式：`GET /proxy?u=<url>&e=<unix-seconds>&s=<signature>`

推荐部署：

1. 将 `src/handler.ts` 部署为 Lambda Function URL 或 API Gateway v2 处理器。
2. 在函数前放置 CloudFront。
3. 转发完整查询字符串，使缓存键包含 `u`、`e` 和 `s`。
4. 设置 `IMAGE_PROXY_SIGNING_SECRET`，并在 Web 应用中使用相同值进行配置，使代理仅接受签名请求。

Web 应用只需将 `NEXT_PUBLIC_IMAGE_PROXY_BASE_URL` 指向 AWS 端点。
`IMAGE_PROXY_SIGNING_SECRET` 必须在应用与代理之间保持一致。
如需接受来自多个客户端的签名，代理可使用逗号分隔的密钥列表进行校验。每个为代理 URL 签名的客户端仍应使用单一密钥。
