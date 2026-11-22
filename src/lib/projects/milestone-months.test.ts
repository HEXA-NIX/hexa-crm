import { describe, expect, it } from "vitest";
import { availableMilestoneMonths, hasDuplicateMilestoneMonths, nextMilestoneMonth } from "./milestone-months";

const options = ["2026-07", "2026-08", "2026-09", "2026-10"].map((value) => ({ value, label: value }));

describe("milestone month selection", () => {
  it("excludes used and earlier months from subsequent milestones", () => {
    expect(availableMilestoneMonths(options, [{ target_month: "2026-08" }, { target_month: "" }], 1).map((item) => item.value))
      .toEqual(["2026-09", "2026-10"]);
  });

  it("selects the first unused month after the latest milestone", () => {
    expect(nextMilestoneMonth(options, [{ target_month: "2026-08" }])).toBe("2026-09");
  });

  it("detects duplicate months", () => {
    expect(hasDuplicateMilestoneMonths([{ target_month: "2026-08" }, { target_month: "2026-08" }])).toBe(true);
  });
});
