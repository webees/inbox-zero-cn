import { describe, expect, it } from "vitest";
import { MailSplitFilterKind, SystemType } from "@/generated/prisma/enums";
import {
  availableLibraryFilters,
  resolveLibraryEntry,
  SPLIT_LIBRARY,
} from "@/utils/split-inbox/split-library";
import { getRuleLabel } from "@/utils/rule/consts";

const otpEntry = SPLIT_LIBRARY.find(
  (entry) => entry.createsSystemType === SystemType.OTP,
);
const toReplyEntry = SPLIT_LIBRARY.find(
  (entry) => entry.name === getRuleLabel(SystemType.TO_REPLY),
);

describe("availableLibraryFilters", () => {
  it("hides label-backed splits when the account has no matching label", () => {
    expect(toReplyEntry).toBeDefined();
    expect(
      resolveLibraryEntry(toReplyEntry!, {
        labelsByName: new Map(),
        categoriesByName: new Map(),
      }),
    ).toBeNull();
    expect(
      availableLibraryFilters(toReplyEntry!, {
        labelsByName: new Map(),
        categoriesByName: new Map(),
      }),
    ).toBeNull();
  });

  it("still offers OTP before the label exists so the library can create the rule", () => {
    expect(otpEntry?.createsSystemType).toBe(SystemType.OTP);
    expect(
      resolveLibraryEntry(otpEntry!, {
        labelsByName: new Map(),
        categoriesByName: new Map(),
      }),
    ).toBeNull();
    expect(
      availableLibraryFilters(otpEntry!, {
        labelsByName: new Map(),
        categoriesByName: new Map(),
      }),
    ).toEqual([]);
  });

  it("resolves OTP to the label filter once the label exists", () => {
    expect(otpEntry).toBeDefined();
    const otpLabelName = getRuleLabel(SystemType.OTP).toLowerCase();
    expect(
      availableLibraryFilters(otpEntry!, {
        labelsByName: new Map([[otpLabelName, "otp-label-id"]]),
        categoriesByName: new Map(),
      }),
    ).toEqual([{ kind: MailSplitFilterKind.LABEL, value: "otp-label-id" }]);
  });
});
