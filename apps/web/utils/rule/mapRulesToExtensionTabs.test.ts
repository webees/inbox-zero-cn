import { describe, expect, it } from "vitest";
import { getAction, getRule } from "@/__tests__/helpers";
import { ActionType } from "@/generated/prisma/enums";
import { mapRulesToExtensionTabs } from "./mapRulesToExtensionTabs";

describe("mapRulesToExtensionTabs", () => {
  it("maps extension-supported labels to built-in tabs", () => {
    const rules = [
      getRule("sync github", [getAction({ label: "GitHub" })]),
      getRule("sync team", [getAction({ label: "团队" })]),
      getRule("sync stripe", [getAction({ label: "Stripe" })]),
    ];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "enable_default",
        tabId: "team",
        displayLabel: "团队",
      },
      {
        type: "enable_default",
        tabId: "github",
        displayLabel: "GitHub",
      },
      {
        type: "enable_default",
        tabId: "stripe",
        displayLabel: "Stripe",
      },
    ]);
  });

  it("keeps unsupported labels as custom tabs", () => {
    const rules = [getRule("sync travel", [getAction({ label: " Travel " })])];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "add_custom",
        label: "Travel",
        icon: "🏷️",
        query: "in:inbox label:travel",
        displayLabel: "Travel",
      },
    ]);
  });

  it("normalizes built-in labels before lookup and dedupe", () => {
    const rules = [
      getRule("sync lowercase team", [getAction({ label: " 团队 " })]),
      getRule("skip duplicate team", [getAction({ label: "团队" })]),
    ];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "enable_default",
        tabId: "team",
        displayLabel: "团队",
      },
    ]);
  });

  it("dedupes built-in labels that only differ by punctuation", () => {
    const rules = [
      getRule("sync follow up", [getAction({ label: "跟进" })]),
      getRule("skip duplicate follow-up", [getAction({ label: "跟进-" })]),
    ];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "enable_default",
        tabId: "follow-up",
        displayLabel: "跟进",
      },
    ]);
  });

  it("preserves distinct custom labels that only differ by punctuation", () => {
    const rules = [
      getRule("sync project dotted", [getAction({ label: "Project.One" })]),
      getRule("sync project space", [getAction({ label: "Project One" })]),
    ];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "add_custom",
        label: "Project One",
        icon: "🏷️",
        query: "in:inbox label:project-one",
        displayLabel: "Project One",
      },
      {
        type: "add_custom",
        label: "Project.One",
        icon: "🏷️",
        query: "in:inbox label:projectone",
        displayLabel: "Project.One",
      },
    ]);
  });

  it("syncs archived label rules with label-only queries", () => {
    const rules = [
      getRule("archive newsletters", [
        getAction({ label: "Newsletter" }),
        getAction({ type: ActionType.ARCHIVE }),
      ]),
      getRule("keep github visible", [getAction({ label: "GitHub" })]),
    ];

    expect(mapRulesToExtensionTabs(rules)).toEqual([
      {
        type: "enable_default",
        tabId: "github",
        displayLabel: "GitHub",
      },
      {
        type: "add_custom",
        label: "Newsletter",
        icon: "🏷️",
        query: "label:newsletter",
        displayLabel: "Newsletter",
      },
    ]);
  });
});
