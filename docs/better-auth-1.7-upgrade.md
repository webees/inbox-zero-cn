# Better Auth 1.7 部署检查清单

所有 Better Auth 包均已对齐到 1.7.4，以修复 OAuth 提供方的资源绑定漏洞。这不仅是一次依赖更新，更是一次认证与身份迁移。请遵循[上游升级指南](https://better-auth.com/docs/guides/1-7-upgrade-guide)。

## 接受流量之前

1. 备份认证与账户开通数据表。在切换期间暂停登录、账号关联和 SCIM 账户开通。在一次性数据库副本上预演。
2. 盘点 `provider` 为 `microsoft` 的 `Account` 行。Better Auth 现在通过已验证的目录 `oid` 而非成对的 `sub` 来识别 Microsoft 账号。请使用已验证的已存储 ID 令牌或可信的 Entra 导出，获得一份经审查的映射：从每个本地账号 ID 和旧 `providerAccountId` 映射到其已验证的 `oid`。仅更新同时匹配经审查的本地 ID 和旧主体的行，并检查唯一性和受影响行数。绝不要根据电子邮件推断此映射。在所有现有身份核对完成前，不要恢复 Microsoft 登录。此迁移不会自动更改任何 Microsoft 数据。
3. 审查已存储的 `ssoProvider.samlConfig` 和 `oidcConfig`。自定义的 `mapping.id` 身份必须核对到已签名的 SAML NameID 或已验证的 OIDC sub。对于 SAML，将 `samlConfig.issuer` 设为现有的 SP 实体 ID，移除曾被用作 `callbackUrl` 的旧 ACS URL，并将 SP 元数据和 IdP 的 ACS 设置更新为 `/api/auth/sso/saml2/sp/acs/{providerId}`。保留现有的 SP 实体 ID 和断言受众。测试现有用户的登录；不要使用电子邮件回退来核对身份。
4. 如果存在遗留的 `scimProvider` 行，请完成下文的 SCIM 步骤。SQL 迁移会刻意拒绝删除有数据的遗留表。请在运行迁移前解决此预检问题；不要绕过针对在线开通数据的保护。
5. 一起应用 Prisma 迁移并部署匹配的应用程序。OAuth schema 新增了资源策略、客户端资源绑定、断言和令牌资源绑定。MCP 功能默认仍处于禁用状态。任何针对未发布的 1.6 MCP 实现注册的客户端都应在切换后重新连接并重新注册。
6. 测试适用于该部署的现有 Google、Microsoft、Apple、SAML 和已开通用户登录；在恢复流量前测试取消开通以及 MCP 授权、刷新和撤销。

## 遗留 SCIM 切换

1.7 插件不会转换遗留凭据或 SCIM 创建的账号。在移除遗留记录之前，导出遗留提供方记录并审查所有已开通用户和认证账号。保留应用程序用户和合法的登录账号；不要按电子邮件或提供方名称批量删除账号。

在经审查的遗留连接记录退役后，应用迁移。设置一个新的、独立的 `SCIM_CREDENTIAL_HASH_SECRET`，长度至少为 32 个字符。不要复用旧的 bearer 令牌、其编码或其哈希。

打开 `/admin` → **SCIM provisioning**，输入已注册的 SSO 提供方 ID 和明确的过期时间，然后选择 **Create SCIM connection**。安全地记录返回的连接 ID 和凭据 ID。令牌仅在创建时返回；请在 IdP 中配置它，且不要记录日志。该操作仅授予 SCIM Users 读写权限。在同一管理区域撤销凭据；替换连接需要各自经审查的身份映射。

在重新开通现有用户之前，使用新连接 ID、IdP 的不可变外部 ID 和经审查的本地用户 ID 填充 `ScimIdentityLink`。未映射的身份会被创建；它们绝不会通过匹配电子邮件进行关联。运行完整的重新开通并验证现有用户保留正确的应用程序身份。SCIM 不会创建认证账号，也不会授予组织角色。现有的应用程序成员身份必须单独审查。

取消开通会记录 `User.scimAccessDisabled` 并以事务方式删除会话。新建会话时会拒绝已禁用的用户。重新开通活跃身份会清除禁用标志。现有会话 cookie 可能会在配置的 cookie 缓存过期之前保持缓存，因此请将该时间间隔纳入访问撤销检查。

## 回滚

如果任何身份或 schema 检查失败，请保持流量暂停。恢复协调的数据库和应用程序备份；不要在新 SCIM schema 上运行 1.6 应用程序。在未修补的版本上保持 MCP 服务器禁用。
