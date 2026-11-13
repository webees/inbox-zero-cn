export function admissionRejectionCopy(code: string | undefined) {
  if (code === "queue_full") {
    return "邮件中存在大量待处理操作。请等待部分操作完成后再试。";
  }
  if (code === "too_large" || code === "storage_unavailable") {
    return "此设备没有足够的存储空间来执行该邮件操作。";
  }
}
