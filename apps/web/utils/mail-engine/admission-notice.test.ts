import { describe, expect, it } from "vitest";
import { admissionRejectionCopy } from "./admission-notice";

describe("admissionRejectionCopy", () => {
  it("explains a full local command queue", () => {
    expect(admissionRejectionCopy("queue_full")).toBe(
      "邮件中存在大量待处理操作。请等待部分操作完成后再试。",
    );
  });

  it("explains disk pressure for blob and mailbox rejects", () => {
    expect(admissionRejectionCopy("too_large")).toBe(
      "此设备没有足够的存储空间来执行该邮件操作。",
    );
    expect(admissionRejectionCopy("storage_unavailable")).toBe(
      "此设备没有足够的存储空间来执行该邮件操作。",
    );
  });

  it("leaves other rejects to the caller", () => {
    expect(admissionRejectionCopy("invalid")).toBeUndefined();
    expect(admissionRejectionCopy("stale_selection")).toBeUndefined();
    expect(admissionRejectionCopy(undefined)).toBeUndefined();
  });
});
