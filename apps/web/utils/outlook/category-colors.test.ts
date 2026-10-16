import { describe, expect, it } from "vitest";
import { OUTLOOK_CATEGORY_COLORS } from "./category-colors";

describe("Outlook category colors", () => {
  it.each([
    ["preset2", "棕色"],
    ["preset3", "黄色"],
    ["preset4", "绿色"],
    ["preset5", "青色"],
    ["preset6", "橄榄色"],
    ["preset7", "蓝色"],
    ["preset8", "紫色"],
    ["preset9", "蔓越莓色"],
  ])("maps %s to the documented %s category color", (id, name) => {
    expect(OUTLOOK_CATEGORY_COLORS.find((color) => color.id === id)?.name).toBe(
      name,
    );
  });
});
