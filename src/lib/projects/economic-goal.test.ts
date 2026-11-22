import { describe, expect, it } from "vitest";
import { economicGoalKey, economicGoalProgress, monthlyEconomicGoal } from "./economic-goal";

describe("monthly economic goals", () => {
  it("isolates the goal by company and month", () => {
    const goals = { [economicGoalKey(2, "2026-08")]: 500_000 };
    expect(monthlyEconomicGoal(goals, 2, "2026-08")).toBe(500_000);
    expect(monthlyEconomicGoal(goals, 1, "2026-08")).toBe(0);
    expect(monthlyEconomicGoal(goals, 2, "2026-09")).toBe(0);
  });

  it("calculates progress and allows showing overachievement", () => {
    expect(economicGoalProgress(250_000, 500_000)).toBe(50);
    expect(economicGoalProgress(600_000, 500_000)).toBe(120);
    expect(economicGoalProgress(10_000, 0)).toBe(0);
  });
});
