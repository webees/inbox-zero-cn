# 移动应用审核访问

这些接口为私有移动应用提供内部 App Store 审核访问。请勿在 `.env.example`
中列出这些设置；普通的自托管用户不需要它们。

为 App Review 需要的每个账号配置 `APP_REVIEW_DEMO_ACCOUNTS`，例如一个有效账号
和一个订阅已过期的账号：

```env
APP_REVIEW_DEMO_ENABLED=true
APP_REVIEW_DEMO_ACCOUNTS='[{"email":"review-active@example.com","code":"active-password"},{"email":"review-expired@example.com","code":"expired-password"}]'
```

每个条目将移动端登录表单中输入的邮箱映射到用作密码的访问码。登录端点要求提供
邮箱，并在创建会话前匹配这两个值。
