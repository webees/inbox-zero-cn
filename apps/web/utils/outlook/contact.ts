import { escapeSearchValue } from "@/utils/outlook/search-escape";
import type { Contact, Person } from "@microsoft/microsoft-graph-types";
import type { Logger } from "@/utils/logger";
import { withMicrosoftGraphRetry } from "@/utils/outlook/retry";
import type { OutlookClient } from "@/utils/outlook/client";
import { isOutlookAccessDeniedError } from "@/utils/error";
import {
  type EmailContact,
  MAX_CONTACT_RESULTS,
  normalizeContactCandidates,
} from "@/utils/email/contact";

const CONTACTS_PAGE_SIZE = 50;
// Graph 联系人服务端不支持子串过滤，因此我们在客户端
// 分页遍历已保存的联系人；该上限限制了查询匹配很少或
// 无匹配时的往返次数。
const MAX_CONTACT_PAGES = 20;

type OutlookContactsPage = {
  value?: Contact[];
  "@odata.nextLink"?: string;
};

export async function searchContacts(
  client: OutlookClient,
  query: string,
  logger: Logger,
) {
  const trimmedQuery = query.trim();

  // 任何单一来源都无法覆盖整个邮箱：/me/contacts 只读取默认的
  // 已保存联系人文件夹，而 /me/people 还会加入目录和近期
  // 通信人。它们的范围是可选的，且是在不同时间请求的，
  // 因此一个账号可能只持有其中之一 —— 对某一来源的拒绝
  // 不能抑制另一来源。
  const [saved, people] = await Promise.all([
    loadContactSource(
      () => listSavedContacts(client, trimmedQuery, logger),
      "contacts",
      logger,
    ),
    loadContactSource(
      () => searchRelevantPeople(client, trimmedQuery, logger),
      "people",
      logger,
    ),
  ]);

  if (saved.deniedError && people.deniedError) throw saved.deniedError;

  // 已保存联系人排在前，因为它们是用户精心维护的通讯录；
  // 随后由按相关性排序的人员填充剩余位置。
  return normalizeContactCandidates([
    ...(saved.contacts ?? []),
    ...(people.contacts ?? []),
  ]);
}

async function loadContactSource(
  load: () => Promise<EmailContact[]>,
  source: "contacts" | "people",
  logger: Logger,
) {
  try {
    return { contacts: await load(), deniedError: undefined };
  } catch (error) {
    if (!isContactSourceDenied(error)) throw error;

    logger.info("不允许使用该 Outlook 联系人来源", { source });
    return { contacts: undefined, deniedError: error };
  }
}

// Graph 将缺失的委派范围报告为 403，其代码因资源而异
// （Outlook 为 ErrorAccessDenied，People 为
// Authorization_RequestDenied），因此当代码不熟悉时回退到状态码。
function isContactSourceDenied(error: unknown) {
  return (
    isOutlookAccessDeniedError(error) ||
    (error as { statusCode?: number })?.statusCode === 403
  );
}

async function listSavedContacts(
  client: OutlookClient,
  query: string,
  logger: Logger,
) {
  const graphClient = client.getClient();
  const normalizedQuery = query.toLowerCase();
  const candidates: EmailContact[] = [];
  let contacts: EmailContact[] = [];
  let request = graphClient
    .api("/me/contacts")
    .select("displayName,emailAddresses")
    .top(CONTACTS_PAGE_SIZE);

  for (let pageIndex = 0; pageIndex < MAX_CONTACT_PAGES; pageIndex++) {
    const page: OutlookContactsPage = await withMicrosoftGraphRetry(
      () => request.get(),
      logger,
    );
    for (const contact of page.value ?? []) {
      const emailAddresses =
        contact.emailAddresses?.flatMap((email) =>
          email.address ? [email.address] : [],
        ) ?? [];
      const matchesQuery =
        !normalizedQuery ||
        contact.displayName?.toLowerCase().includes(normalizedQuery) ||
        emailAddresses.some((emailAddress) =>
          emailAddress.toLowerCase().includes(normalizedQuery),
        );

      if (!matchesQuery) continue;

      candidates.push(
        ...emailAddresses.map((emailAddress) => ({
          emailAddress,
          name: contact.displayName ?? undefined,
        })),
      );
    }

    contacts = normalizeContactCandidates(candidates, MAX_CONTACT_RESULTS);
    if (contacts.length === MAX_CONTACT_RESULTS) return contacts;

    const nextLink = page["@odata.nextLink"];
    if (!nextLink) return contacts;
    request = graphClient.api(nextLink);
  }

  logger.warn("达到最大页数后停止 Outlook 联系人搜索", {
    maxPages: MAX_CONTACT_PAGES,
  });
  return contacts;
}

async function searchRelevantPeople(
  client: OutlookClient,
  query: string,
  logger: Logger,
) {
  let request = client
    .getClient()
    .api("/me/people")
    .select("displayName,scoredEmailAddresses,userPrincipalName");

  if (query) {
    request = request.search(`"${escapeSearchValue(query)}"`);
  }

  const response: { value?: Person[] } = await withMicrosoftGraphRetry(
    () => request.top(MAX_CONTACT_RESULTS).get(),
    logger,
  );

  return (response.value ?? []).flatMap((person) => {
    const addresses = person.scoredEmailAddresses?.length
      ? person.scoredEmailAddresses.map((email) => email.address)
      : [person.userPrincipalName];

    return addresses.flatMap((emailAddress) =>
      emailAddress
        ? [{ emailAddress, name: person.displayName ?? undefined }]
        : [],
    );
  });
}
