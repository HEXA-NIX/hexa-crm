export type MonthlyEconomicGoals = Record<string, number>;

export function economicGoalKey(companyId: number | null, month: string) {
  return `${companyId ?? "unknown"}:${month}`;
}

export function monthlyEconomicGoal(
  goals: MonthlyEconomicGoals | null | undefined,
  companyId: number | null,
  month: string,
) {
  const value = goals?.[economicGoalKey(companyId, month)];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function economicGoalProgress(actualCents: number, goalCents: number) {
  if (goalCents <= 0) return 0;
  return Math.max(0, Math.round((actualCents / goalCents) * 100));
}
