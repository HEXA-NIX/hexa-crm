export type MilestoneMonthOption = { value: string; label: string };
export type MilestoneWithMonth = { target_month: string };

export function availableMilestoneMonths(
  options: MilestoneMonthOption[],
  milestones: MilestoneWithMonth[],
  index: number,
): MilestoneMonthOption[] {
  const usedByOthers = new Set(
    milestones.filter((_, itemIndex) => itemIndex !== index).map((item) => item.target_month).filter(Boolean),
  );
  const previousMonth = milestones
    .slice(0, index)
    .map((item) => item.target_month)
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";

  return options.filter((option) => !usedByOthers.has(option.value) && option.value > previousMonth);
}

export function nextMilestoneMonth(
  options: MilestoneMonthOption[],
  milestones: MilestoneWithMonth[],
): string {
  const latest = milestones.map((item) => item.target_month).filter(Boolean).sort().at(-1) ?? "";
  const used = new Set(milestones.map((item) => item.target_month).filter(Boolean));
  return options.find((option) => option.value > latest && !used.has(option.value))?.value ?? "";
}

export function hasDuplicateMilestoneMonths(milestones: MilestoneWithMonth[]): boolean {
  const months = milestones.map((item) => item.target_month).filter(Boolean);
  return new Set(months).size !== months.length;
}
