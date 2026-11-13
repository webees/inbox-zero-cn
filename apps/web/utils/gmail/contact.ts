import type { people_v1 } from "@googleapis/people";
import {
  ContactsAccessDeniedError,
  MAX_CONTACT_RESULTS,
  normalizeContactCandidates,
} from "@/utils/email/contact";
import { env } from "@/env";
import { canonicalizeEmailAddress } from "@/utils/email";
import {
  isGmailInsufficientPermissionsError,
  isGmailQuotaExceededError,
  isGmailRateLimitExceededError,
} from "@/utils/error";
import { extractErrorInfo } from "@/utils/gmail/retry";
import type { Logger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

const CONTACT_READ_MASK = "names,emailAddresses,photos";
const PHOTO_READ_MASK = "emailAddresses,photos";
const PHOTO_PAGE_SIZE = 1000;
const MAX_PHOTO_PAGES = 5;
// 限制缓存映射的大小以及发送到浏览器的数据量。
const MAX_CONTACT_PHOTOS = 2000;
// People API 会拒绝更长的查询，而姓名或地址前缀不会达到这个长度。
const MAX_PEOPLE_QUERY_LENGTH = 100;

export async function searchContacts(
  client: people_v1.People,
  query: string,
  logger: Logger,
) {
  if (query.length > MAX_PEOPLE_QUERY_LENGTH) return [];

  if (!env.NEXT_PUBLIC_GMAIL_OTHER_CONTACTS_ENABLED) {
    const onlySource = await loadContactSource(
      () => searchSavedContacts(client, query),
      "contacts",
      logger,
    );
    if (onlySource.deniedError) {
      throw new ContactsAccessDeniedError({ cause: onlySource.deniedError });
    }

    return normalizeContactCandidates(onlySource.contacts ?? []);
  }

  // 已保存的 Google 联系人只是用户整理过的通讯录。Gmail 的
  // 写信自动补全还会搜索其他联系人（用户曾发过邮件的人），
  // 因此需要同时查询这两个来源才能提供类似 Gmail 的建议。
  const [saved, other] = await Promise.all([
    loadContactSource(
      () => searchSavedContacts(client, query),
      "contacts",
      logger,
    ),
    loadContactSource(
      () => searchOtherContacts(client, query),
      "otherContacts",
      logger,
    ),
  ]);

  if (saved.deniedError && other.deniedError) {
    throw new ContactsAccessDeniedError({ cause: saved.deniedError });
  }

  return normalizeContactCandidates([
    ...(saved.contacts ?? []),
    ...(other.contacts ?? []),
  ]);
}

/** 按规范电子邮件地址索引的真实（非占位）联系人照片。 */
export async function listContactPhotos(
  client: people_v1.People,
  logger: Logger,
) {
  const [saved, other] = await Promise.all([
    loadContactSource(
      () =>
        listPeoplePages(async (pageToken) => {
          const res = await client.people.connections.list({
            resourceName: "people/me",
            personFields: PHOTO_READ_MASK,
            pageSize: PHOTO_PAGE_SIZE,
            pageToken,
          });
          return {
            people: res.data.connections,
            nextPageToken: res.data.nextPageToken,
          };
        }),
      "contacts",
      logger,
    ),
    env.NEXT_PUBLIC_GMAIL_OTHER_CONTACTS_ENABLED
      ? loadContactSource(
          () =>
            listPeoplePages(async (pageToken) => {
              const res = await client.otherContacts.list({
                readMask: PHOTO_READ_MASK,
                pageSize: PHOTO_PAGE_SIZE,
                pageToken,
              });
              return {
                people: res.data.otherContacts,
                nextPageToken: res.data.nextPageToken,
              };
            }),
          "otherContacts",
          logger,
        )
      : undefined,
  ]);

  // 空映射会被缓存为“此账号没有照片”。
  if (saved.deniedError && (!other || other.deniedError))
    throw saved.deniedError;

  const photos: Record<string, string> = {};
  let count = 0;
  // 已保存的联系人优先，这样用户亲自选择的照片会胜出。
  for (const person of [
    ...(saved.contacts ?? []),
    ...(other?.contacts ?? []),
  ]) {
    const photoUrl = getPhotoUrl(person);
    if (!photoUrl) continue;

    for (const emailAddress of person.emailAddresses ?? []) {
      if (!emailAddress.value) continue;
      const key = canonicalizeEmailAddress(emailAddress.value);
      if (photos[key]) continue;

      photos[key] = photoUrl;
      count++;
      if (count === MAX_CONTACT_PHOTOS) return photos;
    }
  }

  return photos;
}

async function loadContactSource<T>(
  load: () => Promise<T[]>,
  source: "contacts" | "otherContacts",
  logger: Logger,
) {
  try {
    return { contacts: await load(), deniedError: undefined };
  } catch (error) {
    if (!isContactSourceDenied(error)) throw error;

    logger.info("不允许访问 Gmail 联系人来源", { source });
    return { contacts: undefined, deniedError: error };
  }
}

function isContactSourceDenied(error: unknown) {
  // Google 的 403 限流响应会复用 PERMISSION_DENIED；不要将其视为缺少访问权限。
  if (
    isGmailRateLimitExceededError(error) ||
    isGmailQuotaExceededError(error)
  ) {
    return false;
  }

  if (isGmailInsufficientPermissionsError(error)) return true;

  const record = error as { code?: unknown; status?: unknown };
  if (
    record.status === "PERMISSION_DENIED" ||
    record.code === "PERMISSION_DENIED"
  ) {
    return true;
  }

  const errorInfo = extractErrorInfo(error);
  return (
    errorInfo.reason === "insufficientPermissions" ||
    errorInfo.googleErrorStatus === "PERMISSION_DENIED"
  );
}

async function searchSavedContacts(client: people_v1.People, query: string) {
  // Google 要求在搜索联系人缓存之前先用空查询进行预热。
  if (query) {
    await client.people.searchContacts({
      query: "",
      readMask: CONTACT_READ_MASK,
      pageSize: MAX_CONTACT_RESULTS,
    });
  }

  const res = await withContactCacheRetry(() =>
    client.people.searchContacts({
      query,
      readMask: CONTACT_READ_MASK,
      pageSize: MAX_CONTACT_RESULTS,
    }),
  );

  return mapSearchResults(res.data.results);
}

async function searchOtherContacts(client: people_v1.People, query: string) {
  if (query) {
    await client.otherContacts.search({
      query: "",
      readMask: CONTACT_READ_MASK,
      pageSize: MAX_CONTACT_RESULTS,
    });
  }

  const res = await withContactCacheRetry(() =>
    client.otherContacts.search({
      query,
      readMask: CONTACT_READ_MASK,
      pageSize: MAX_CONTACT_RESULTS,
    }),
  );

  return mapSearchResults(res.data.results);
}

function mapSearchResults(
  results: people_v1.Schema$SearchResult[] | undefined,
) {
  return (
    results?.flatMap((contact) => {
      const person = contact.person;
      if (!person) return [];

      return (person.emailAddresses ?? []).flatMap((emailAddress) =>
        emailAddress.value
          ? [
              {
                emailAddress: emailAddress.value,
                name: person.names?.[0]?.displayName ?? undefined,
                profilePictureUrl: getPhotoUrl(person),
              },
            ]
          : [],
      );
    }) ?? []
  );
}

async function listPeoplePages(
  loadPage: (pageToken: string | undefined) => Promise<{
    people: people_v1.Schema$Person[] | undefined;
    nextPageToken: string | null | undefined;
  }>,
) {
  const people: people_v1.Schema$Person[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PHOTO_PAGES; page++) {
    const result = await loadPage(pageToken);
    people.push(...(result.people ?? []));
    pageToken = result.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return people;
}

// 当某人没有照片时，Google 会填入自动生成的字母图块。
function getPhotoUrl(person: people_v1.Schema$Person) {
  return person.photos?.find((photo) => !photo.default)?.url ?? undefined;
}

async function withContactCacheRetry<T>(search: () => Promise<T>): Promise<T> {
  try {
    return await search();
  } catch (error) {
    const { status, googleErrorStatus, errorMessage, googleErrorMessage } =
      extractErrorInfo(error);
    if (
      (status !== 400 && googleErrorStatus !== "FAILED_PRECONDITION") ||
      ![errorMessage, googleErrorMessage].some(
        (message) =>
          typeof message === "string" && message.includes("cold cache data"),
      )
    ) {
      throw error;
    }

    // 预热返回后，Google 的延迟缓存可能仍在重建。
    await sleep(5000);
    return search();
  }
}
