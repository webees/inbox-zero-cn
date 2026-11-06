"use server";

import { env } from "@/env";
import { ssoRegistrationBody } from "@/utils/actions/sso.validation";
import { adminActionClient } from "@/utils/actions/safe-action";
import { auth } from "@/utils/auth";
import { SafeError } from "@/utils/error";
import { extractSSOProviderConfigFromXML } from "@/utils/sso/extract-sso-provider-config-from-xml";
import prisma from "@/utils/prisma";
import { validateIdpMetadata } from "@/utils/sso/validate-idp-metadata";
import { ADMIN_ROLES } from "@/utils/organizations/roles";
import { slugify } from "@/utils/string";
import { isDuplicateError } from "@/utils/prisma-helpers";

export const registerSSOProviderAction = adminActionClient
  .metadata({ name: "registerSSOProvider" })
  .inputSchema(ssoRegistrationBody)
  .action(
    async ({
      parsedInput: {
        organizationName,
        organizationId,
        idpMetadata,
        domain,
        providerId,
      },
    }) => {
      const session = await auth();
      const userId = session?.user?.id;

      if (!userId) throw new SafeError("未授权");

      if (!validateIdpMetadata(idpMetadata))
        throw new SafeError("IDP 元数据 XML 无效。");

      const ssoConfig = extractSSOProviderConfigFromXML(
        idpMetadata,
        providerId,
      );

      const existingSSOProvider = await prisma.ssoProvider.findUnique({
        where: {
          providerId: providerId,
        },
      });

      if (existingSSOProvider) {
        throw new SafeError(`ID 为 "${providerId}" 的 SSO 服务商已存在`);
      }

      // 创建组织
      const organizationSlug = slugify(organizationName);

      const existingOrganization = await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: {
          id: true,
          name: true,
          slug: true,
          SsoProvider: { select: { providerId: true } },
          members: {
            where: { role: { in: ADMIN_ROLES } },
            select: { emailAccount: { select: { email: true } } },
          },
        },
      });

      if (existingOrganization) {
        if (existingOrganization.id !== organizationId) {
          throw new SafeError(
            "已存在同名组织。请输入其准确的组织 ID 以附加 SSO。",
          );
        }

        if (existingOrganization.SsoProvider) {
          throw new SafeError("此组织已配置 SSO 服务商。");
        }

        // 防止抢占 slug：只有当现有组织的某位所有者/管理员属于该 SSO 域名时，
        // 才将 SSO 附加到该组织。
        const domainSuffix = `@${domain.toLowerCase()}`;
        const hasAdminOnDomain = existingOrganization.members.some((member) =>
          member.emailAccount.email.toLowerCase().endsWith(domainSuffix),
        );

        if (!hasAdminOnDomain) {
          throw new SafeError(
            `已存在同名组织，但其所有者或管理员都没有使用 "${domain}" 域名的邮箱。请在附加 SSO 前核实该组织，或选择其他名称。`,
          );
        }
      } else if (organizationId) {
        throw new SafeError("组织名称与提供的组织 ID 不匹配。");
      }

      const organization =
        existingOrganization ??
        (await prisma.organization.create({
          data: {
            name: organizationName,
            slug: organizationSlug,
          },
          select: { id: true, name: true, slug: true },
        }));

      const callbackUrl = new URL(
        `/api/auth/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`,
        env.NEXT_PUBLIC_BASE_URL,
      ).toString();

      const samlConfig = {
        issuer: env.NEXT_PUBLIC_BASE_URL,
        entryPoint: ssoConfig.entryPoint,
        cert: ssoConfig.cert,
        wantAssertionsSigned: ssoConfig.wantAssertionsSigned ?? true,
        signatureAlgorithm: "sha256",
        digestAlgorithm: "sha256",
        identifierFormat:
          "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        idpMetadata: {
          metadata: idpMetadata,
          isAssertionEncrypted: false,
        },
        spMetadata: {
          metadata: ssoConfig.spMetadata,
          binding: "post",
          isAssertionEncrypted: false,
        },
      } as const;

      const created = await prisma.ssoProvider
        .create({
          data: {
            providerId,
            issuer: ssoConfig.issuer,
            domain,
            samlConfig: JSON.stringify(samlConfig),
            userId,
            organizationId: organization.id,
          },
          select: {
            id: true,
            providerId: true,
            domain: true,
            organization: {
              select: { id: true, name: true, slug: true },
            },
          },
        })
        .catch((error: unknown) => {
          if (isDuplicateError(error, "organizationId")) {
            throw new SafeError("此组织已配置 SSO 服务商。");
          }

          if (isDuplicateError(error, "providerId")) {
            throw new SafeError(`ID 为 "${providerId}" 的 SSO 服务商已存在`);
          }

          throw error;
        });

      return { ...created, callbackUrl };
    },
  );
