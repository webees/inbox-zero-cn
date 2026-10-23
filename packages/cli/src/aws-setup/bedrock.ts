import * as p from "@clack/prompts";

export async function getBedrockCredentials(nonInteractive: boolean) {
  let accessKey = process.env.BEDROCK_ACCESS_KEY;
  let secretKey = process.env.BEDROCK_SECRET_KEY;
  if (nonInteractive && (!accessKey || !secretKey)) {
    throw new Error(
      "在运行无人值守的 AWS 部署前，请为已部署应用的 Bedrock 访问设置 BEDROCK_ACCESS_KEY 和 BEDROCK_SECRET_KEY。",
    );
  }
  if (!accessKey || !secretKey) {
    p.log.info(
      "已部署的应用需要自己的 Bedrock 凭证。本地 AWS 部署配置文件不会传递给 ECS。",
    );
    const credentials = await p.group(
      {
        accessKey: () =>
          p.text({
            message: "Bedrock 访问密钥 ID",
            initialValue: accessKey,
            validate: (value) => (value ? undefined : "访问密钥为必填项"),
          }),
        secretKey: () =>
          p.password({
            message: "Bedrock 私有访问密钥",
            validate: (value) => (value ? undefined : "私有密钥为必填项"),
          }),
      },
      {
        onCancel: () => {
          p.cancel("安装已取消。");
          process.exit(0);
        },
      },
    );
    accessKey = credentials.accessKey;
    secretKey = credentials.secretKey;
  }
  if (!accessKey || !secretKey)
    throw new Error("BEDROCK_ACCESS_KEY 和 BEDROCK_SECRET_KEY 为必填项");
  return { BEDROCK_ACCESS_KEY: accessKey, BEDROCK_SECRET_KEY: secretKey };
}
