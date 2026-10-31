import { escapeSearchValue } from "@/utils/outlook/search-escape";
import type { Contact, Person } from "@microsoft/microsoft-graph-types";
import type { Logger } from "@/utils/logger";
import { withMicrosoftGraphRetry } from "@/utils/outlook/retry";
import type { OutlookClient } from "@/utils/outlook/client";
import { isOutlookAccessDeniedError } from "@/utils/error";
import {
  ContactsAccessDeniedError,
  type EmailContact,
  MAX_CONTACT_RESULTS,
  normalizeContactCandidates,
} from "@/utils/email/contact";

const CONTACTS_PAGE_SIZE = 50;
// Graph contacts don't support substring filtering server-side, so we page
// through saved contacts client-side; the cap bounds round-trips for queries
// with few or no matches.
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

  // Neither source alone covers a mailbox: /me/contacts reads only the default
  // 已保存联系人文件夹，而 /me/people 还会加入目录和近期通信人。它们的
  // 权限范围是可选的，且是在不同时间请求的，因此账号可能只拥有其中一种权限——
  // 一个来源被拒绝不能抑制另一个来源。
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

  if (saved.deniedError && people.deniedError) {
    throw new ContactsAccessDeniedError({ cause: saved.deniedError });
  }

  // 已保存联系人排在前面，因为它们是用户整理的通讯录；随后由按相关度排序的人员填充剩余位置。
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

    logger.info("不允许访问 Outlook 联系人来源", { source });
    return { contacts: undefined, deniedError: error };
  }
}

// Graph 会把缺失的委派权限报告为 403，其代码因资源而异
// （Outlook 为 ErrorAccessDenied，People 为 Authorization_RequestDenied），
// 因此当代码不熟悉时回退到状态码判断。
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

  logger.warn("Stopped Outlook contact search after max pages", {
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
