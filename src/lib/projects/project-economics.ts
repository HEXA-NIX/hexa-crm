import type { CashMovement, WorkProject } from "../types";

export type ProjectEconomicPoint = {
  month: string;
  label: string;
  planned_cents: number;
  billed_cents: number;
};

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDate(value: string): Date {
  return new Date(`${value.slice(0, 7)}-01T12:00:00`);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1, 12);
}

export function buildProjectEconomicSeries(
  project: WorkProject,
  movements: CashMovement[],
  referenceDate = new Date(),
): ProjectEconomicPoint[] {
  const income = movements.filter((movement) => movement.kind === "income" && movement.project_id === project.id);
  const milestoneMonths = project.revenue_milestones.map((milestone) => milestone.target_month);
  const movementMonths = income.map((movement) => movement.occurred_at.slice(0, 7));
  const fallbackMonth = monthKey(referenceDate);
  const startMonth = project.start_date?.slice(0, 7) || project.created_at.slice(0, 7) || milestoneMonths[0] || movementMonths[0] || fallbackMonth;
  const endMonth = [project.target_date?.slice(0, 7), ...milestoneMonths, ...movementMonths, fallbackMonth]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || fallbackMonth;

  const start = monthDate(startMonth);
  const end = monthDate(endMonth);
  const target = monthDate(project.target_date?.slice(0, 7) || endMonth);
  const plannedMonthCount = Math.max(1, (target.getFullYear() - start.getFullYear()) * 12 + target.getMonth() - start.getMonth() + 1);
  const totalMonths = Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
  const step = Math.max(1, Math.ceil(totalMonths / 12));
  const dates: Date[] = [];
  for (let index = 0; index < totalMonths; index += step) dates.push(addMonths(start, index));
  if (monthKey(dates.at(-1) || start) !== endMonth) dates.push(end);

  return dates.map((date, index) => {
    const month = monthKey(date);
    const billed = income
      .filter((movement) => movement.occurred_at.slice(0, 7) <= month)
      .reduce((sum, movement) => sum + movement.amount_cents, 0);
    const elapsedPlanMonths = Math.max(1, (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth() + 1);
    const planned = project.customer_id != null
      ? Math.round(project.value_cents * Math.min(1, elapsedPlanMonths / plannedMonthCount))
      : project.revenue_milestones
          .filter((milestone) => milestone.target_month <= month)
          .reduce((sum, milestone) => sum + milestone.amount_cents, 0);

    return {
      month,
      label: date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", ""),
      planned_cents: planned,
      billed_cents: billed,
    };
  });
}
