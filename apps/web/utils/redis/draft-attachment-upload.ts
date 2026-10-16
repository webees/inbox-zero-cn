import { redis } from "@/utils/redis";

// Long enough to upload 15 MB on a slow connection; Gmail keeps the session
// 大约一周，因此我们的总是先过期。
const UPLOAD_TTL_SECONDS = 60 * 60;

type DraftAttachmentUpload = {
  draftId: string;
  attachmentId: string;
  sessionUri: string;
  totalBytes: number;
  nextOffset: number;
};

export async function saveDraftAttachmentUpload(
  emailAccountId: string,
  uploadId: string,
  upload: DraftAttachmentUpload,
) {
  await redis.set(uploadKey(emailAccountId, uploadId), upload, {
    ex: UPLOAD_TTL_SECONDS,
  });
}

export async function getDraftAttachmentUpload(
  emailAccountId: string,
  uploadId: string,
) {
  return redis.get<DraftAttachmentUpload>(uploadKey(emailAccountId, uploadId));
}

export async function deleteDraftAttachmentUpload(
  emailAccountId: string,
  uploadId: string,
) {
  await redis.del(uploadKey(emailAccountId, uploadId));
}

// 账号是键的一部分，因此另一个账号的上传 id 找不到任何内容。
function uploadKey(emailAccountId: string, uploadId: string) {
  return `draft-attachment-upload:${emailAccountId}:${uploadId}`;
}
